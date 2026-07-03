# SmartCity Traffic Simulator Architecture Justification
*(Bahan Tanya Jawab Dosen Penguji)*

Dokumen ini menjelaskan alasan teknis pemilihan arsitektur, justifikasi teknologi, desain sinkronisasi konkurensi, dan analisis trade-off pada SmartCity Traffic Simulator.

---

## 1. Pemilihan Bahasa & GUI
Kami memilih **HTML5 Canvas + Vanilla CSS3 + Javascript (ES6+)** dengan runtime **Web Browser**:

### Justifikasi Lintas Platform
- **Cross-Platform Sejati**: Aplikasi berbasis web dapat dijalankan langsung di Chrome/Edge/Firefox di Windows, macOS, maupun Linux tanpa memerlukan instalasi JDK, Python env, compiler C++, atau CMake.
- **Portabilitas Tinggi**: Penguji hanya perlu menjalankan satu perintah `npm start` untuk mengaktifkan server dan mengakses simulator via browser lokal.

### Performa Rendering
- **HTML5 Canvas**: Menggambar ribuan kendaraan dan garis jalan secara bare-metal pada tingkat piksel (low-level rendering) terbukti lebih efisien dibandingkan memanipulasi ribuan node DOM (seperti pada React/SVG-heavy UI) yang memicu reflow/repaint berlebihan.
- **requestAnimationFrame**: Sinkron dengan refresh rate monitor (biasanya 60Hz), memastikan animasi pergerakan kendaraan terasa sangat halus tanpa blocking UI.

---

## 2. Arsitektur Konkurensi: Shared Memory & Worker Pool
Untuk memisahkan beban kerja komputasi berat dari UI Thread, kami menggunakan **Web Workers** yang dipadukan dengan **SharedArrayBuffer**:

```
[Main Thread] (UI, Renderer)
      │ (Reads shared state / triggers updates)
      ▼
┌────────────────────────────────────────────────────────┐
│ Shared Memory (SharedArrayBuffer)                      │
│ - Distance Matrix, Next-Hop matrix, Vehicle coordinates│
└────────────────────────────────────────────────────────┘
      ▲
      │ (Writes state / runs parallel calculations)
[Worker Thread Pool] (Thread 1 - 16)
```

### Mengapa SharedArrayBuffer?
- **Zero-Copy Memory Sharing**: Tanpa SharedArrayBuffer, Web Workers berkomunikasi menggunakan metode `postMessage` standar yang menserialisasi data menggunakan algoritma *Structured Clone*. Mentransfer matriks ukuran $1000 \times 1000$ (4MB) bolak-balik setiap tick simulasi akan menimbulkan overhead latensi serialization yang sangat tinggi, menurunkan FPS secara drastis.
- **Direct Memory Access**: Main thread dan worker thread mengakses alamat memori fisik yang sama secara simultan melalui representasi Typed Array (`Float32Array`, `Int32Array`, `Uint8Array`).

### Rancangan Alokasi Memori Bersama (Shared Memory Layout)

Untuk menghindari alokasi dinamis saat runtime yang memicu *garbage collection (GC) pauses*, seluruh memori dialokasikan secara statis di awal (pre-allocated) dengan struktur sebagai berikut:

| Buffer Name | Data Type | Dimensions / Size | Total Bytes | Deskripsi Fungsi |
| :--- | :--- | :--- | :--- | :--- |
| `weights` | `Float32` | $1000 \times 1000$ (Max V) | 4,000,000 | Menyimpan bobot asli dari setiap jalan (edge weight). |
| `blocked` | `Int32` | $1000 \times 1000$ (Max V) | 4,000,000 | Menyimpan status jalan diblokir (1) atau aktif (0) secara dinamis. |
| `coords` | `Float32` | $1000 \times 2$ (X, Y) | 8,000 | Menyimpan koordinat 2D persimpangan jalan di kanvas. |
| `activeNodes`| `Uint8` | $1000$ (Max V) | 1,000 | Bendera/flag keaktifan node persimpangan. |
| `fwDistance` | `Float32` | $1000 \times 1000$ (Max V) | 4,000,000 | Matriks hasil pencarian jarak terpendek algoritma Floyd-Warshall. |
| `fwNext` | `Int32` | $1000 \times 1000$ (Max V) | 4,000,000 | Matriks *next-hop pointer* untuk rekonstruksi rute kendaraan. |
| `vehicleInts`| `Int32` | $10000 \times 8$ (Max N) | 320,000 | Data integer kendaraan: ID, tipe, state (Moving/Waiting/Stuck), origin, dest, path index, dll. |
| `vehicleFloats`|`Float32`| $10000 \times 8$ (Max N) | 320,000 | Data desimal kendaraan: progress jalan, speed, total travel time, koordinat X/Y, dan delay timer. |
| `vehiclePaths`| `Int32` | $10000 \times 100$ | 4,000,000 | Jalur rute persimpangan (maksimal 100 node) yang dilalui tiap kendaraan. |
| `sync` | `Int32` | $1050$ | 4,200 | Pengontrol Barrier (indeks 0-3) dan kunci atomik (lock) persimpangan (indeks 10-1010). |

Total memori statis yang dipesan di awal adalah sekitar **20.65 MB**. Pendekatan alokasi flat satu dimensi ini mempermudah perhitungan indeks pointer berbasis offset linear `row * MAX_VERTICES + col`.

---

## 3. Desain Barrier Synchronization & Atomics
Berbagi memori secara paralel memicu ancaman *data race* dan *deadlock*. Untuk mengatasinya, kami merancang dua mekanisme sinkronisasi tingkat rendah:

### 1. Barrier Floyd-Warshall (Atomics.wait & Atomics.notify)
Dalam komputasi paralel Floyd-Warshall untuk setiap iterasi $k \in \{0, \dots, V-1\}$, semua thread pekerja harus dipastikan telah selesai membaca dan menulis data baris tugas mereka pada langkah $k-1$ sebelum diperbolehkan maju ke langkah $k$.
```javascript
function barrier() {
  const currentPhase = Atomics.load(sync, 2);
  const completed = Atomics.add(sync, 1, 1) + 1;
  
  if (completed === numWorkers) {
    Atomics.store(sync, 1, 0); // Reset completed count
    Atomics.add(sync, 2, 1);    // Advance barrier phase
    Atomics.notify(sync, 2);    // Wake up all waiting workers
  } else {
    while (Atomics.load(sync, 2) === currentPhase) {
      Atomics.wait(sync, 2, currentPhase); // Thread sleep safely
    }
  }
}
```
*Justifikasi:* Pendekatan ini aman dari CPU spinning (busy-waiting) yang memakan resource, karena OS akan menidurkan thread yang menunggu dan hanya membangunkannya kembali ketika Atomics fase diubah.

### 2. Intersection Slot Lock (Atomics.compareExchange)
Ketika beberapa kendaraan di thread yang berbeda mencoba memasuki persimpangan (node) yang sama pada waktu bersamaan, terjadi persaingan memori. Kami mengatasinya menggunakan operasi CAS (*Compare-And-Swap*):
```javascript
const lockIndex = 10 + nodeIndex;
// Jika nilai lockIndex adalah 0 (unlocked), ubah menjadi 1 (locked) secara atomik
const currentLock = Atomics.compareExchange(sync, lockIndex, 0, 1);
if (currentLock === 0) {
  // Masuk persimpangan, lalu lepas kunci
  Atomics.store(sync, lockIndex, 0);
} else {
  // Tunggu tick berikutnya (antre)
}
```
*Justifikasi:* Menjamin keamanan konkurensi (*thread safety*) dan mencegah kendaraan saling menabrak atau menumpuk di persimpangan jalan secara ilegal.

---

## 4. Analisis Trade-Off & Limitasi

1. **Memory Pre-Allocation**:
   - *Trade-off*: Kami mengalokasikan ukuran statis tetap untuk maksimal 1.000 node graf dan 10.000 kendaraan sejak inisialisasi aplikasi.
   - *Alasan*: Alokasi dinamis `SharedArrayBuffer` di tengah jalan tidak dimungkinkan di JavaScript. Pre-allocation mencegah overhead alokasi memori berulang serta garbage collection (GC) pauses selama simulasi berjalan.
2. **Headless Benchmark Mode**:
   - *Trade-off*: Visualisasi canvas dihentikan sementara saat tombol Benchmark ditekan.
   - *Alasan*: Untuk mengukur performa murni CPU multithreading secara objektif tanpa terdistraksi oleh overhead pemanggilan GPU/Canvas rendering oleh browser.
