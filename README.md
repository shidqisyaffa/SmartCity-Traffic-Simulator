# SmartCity Traffic Simulator

A high-performance interactive graphical traffic simulator designed to demonstrate and benchmark the performance, correctness, and scaling of **Sequential Computing** versus **Parallel Computing** using Graph Theory and Discrete Event Simulation.

Developed with **HTML5 Canvas, Vanilla CSS3, Javascript (ES6+), Web Workers, and SharedArrayBuffer**.

---

## 🚀 Quick Start (Single-Command)

To run the application locally, you only need **Node.js** installed on your system.

1. Clone or navigate to the project directory:
   ```bash
   cd studi_kasus_3
   ```
2. Start the local server:
   ```bash
   npm start
   ```
3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

> [!IMPORTANT]
> **Mengapa Harus Menggunakan Server (`server.js`)?**
> Simulator ini memanfaatkan `SharedArrayBuffer` untuk berbagi memori zero-copy antar thread. Browser modern mewajibkan header keamanan khusus (`COOP` dan `COEP`) untuk mencegah celah keamanan Spectre. Server Node.js bawaan menyematkan header ini secara otomatis.

---

## 📂 Struktur Direktori & Komponen Utama

Berikut adalah deskripsi berkas-berkas utama di dalam repositori ini agar mempermudah pemahaman struktur proyek:

- **`index.html`**: Halaman web utama yang menyediakan tata letak UI, panel kontrol interaktif, canvas simulasi, dan dashboard monitoring.
- **`styles.css`**: Lembar gaya CSS3 kustom dengan estetika premium gelap (dark mode), tata letak responsif, dan animasi transisi.
- **`server.js`**: Server HTTP Node.js bawaan yang menyematkan header COOP/COEP agar SharedArrayBuffer dapat diaktifkan di browser.
- **`package.json`**: Konfigurasi npm yang menyertakan skrip untuk menjalankan server lokal.
- **`js/`** *(Direktori Source Code Javascript)*:
  - **[`app.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/app.js)**: Penghubung utama antara UI, visualisasi canvas, parameter kontrol, dan simulasi.
  - **[`graph.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/graph.js)**: Struktur data graf kota ($G = (V,E)$) dengan representasi memori bersama (Shared Memory).
  - **[`simulation.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/simulation.js)**: Logika simulasi utama, penanganan tick rate, pembuatan kendaraan, serta pembaruan sekuensial.
  - **[`renderer.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/renderer.js)**: Engine rendering berbasis HTML5 Canvas untuk menggambar persimpangan, jalan, dan kendaraan dengan sistem heatmap kemacetan.
  - **[`worker-pool.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/worker-pool.js)**: Pengelola thread pool Web Workers untuk mempartisi beban komputasi secara adil ke core CPU.
  - **[`worker.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/worker.js)**: Kode Web Worker mandiri yang melakukan pembaruan status kendaraan dan komputasi Floyd-Warshall secara paralel di thread latar belakang.
  - **[`tests.js`](file:///c:/kuliah/semester%208/APP/studi_kasus_3/js/tests.js)**: Suite pengujian otomatis untuk memverifikasi kebenaran operasi graf, validitas jalur terpendek, dan kesetaraan (equivalence) hasil komputasi sekuensial vs paralel.

---

## 📚 Teori & Konsep Pemrograman Paralel

### 1. Shortest Path: Floyd-Warshall Algorithm
Algoritma Floyd-Warshall mencari jalur terpendek untuk seluruh pasangan titik (*all-pairs shortest paths*) pada graf berarah dengan kompleksitas waktu sekuensial sebesar $\mathcal{O}(V^3)$.
Formula Dynamic Programming:
$$D^{(k)}[i][j] = \min \left( D^{(k-1)}[i][j], D^{(k-1)}[i][k] + D^{(k-1)}[k][j] \right)$$

### 2. Paralelisasi Menggunakan Web Workers & Barrier Sync
Pada iterasi luar $k$, pembaruan baris matriks $i$ bersifat independen dan dapat dikerjakan secara paralel oleh thread-thread di worker pool. Namun, sebelum masuk ke iterasi $k+1$, semua thread wajib disinkronkan menggunakan **Thread Barrier** agar tidak terjadi race condition pembacaan status memori yang belum selesai ditulis.
Barrier diimplementasikan menggunakan:
- `Atomics.add()` untuk menghitung jumlah thread yang telah sampai pada barrier.
- `Atomics.wait()` dan `Atomics.notify()` untuk menahan thread hingga seluruh pekerja menyelesaikan iterasi $k$.

### 3. Analisis Hukum Amdahl (Amdahl's Law)
Hukum Amdahl merumuskan batas speedup teoritis pada pemrograman paralel:
$$S_p = \frac{1}{(1 - P) + \frac{P}{p}}$$
Dimana:
- $P$ adalah porsi program yang dapat diparalelkan (Floyd-Warshall loop).
- $1-P$ adalah fraksi serial (inisialisasi data, barrier synchronization, thread spawn overhead).
- $p$ adalah alokasi jumlah thread.
Pada graf berukuran kecil, parallel overhead (barrier waiting time & thread communication) mendominasi, menghasilkan efisiensi yang rendah. Pada graf besar ($V \ge 250$), paralel memberikan keuntungan speedup yang signifikan.

---

## ⚙️ Skenario Pengujian & Presentasi

Didesain khusus untuk keperluan demo di hadapan dosen penguji tanpa perlu memodifikasi kode:

1. **Sequential Baseline Test**:
   - Pilih mode **Sequential (Single-Thread)**.
   - Klik **Spawn & Routify Vehicles** (misal 500 kendaraan).
   - Klik **Start Simulation** dan amati kelancaran lalu lintas serta travel time.
2. **Parallel Scaling Test**:
   - Beralih ke mode **Parallel (Web Workers)**.
   - Geser slider alokasi thread (1, 2, 4, 8, 16) untuk melihat perubahan execution time secara instan.
3. **Scientific Benchmark Tab**:
   - Pindah ke tab **Scientific Benchmark**.
   - Klik **Run Scientific Benchmark Suite**.
   - Sistem akan memicu komputasi benchmark pada graf $V=250$ dan menghasilkan visualisasi grafik komparasi Execution Time, Speedup, dan Efisiensi secara nyata beserta analisis Hukum Amdahl.
4. **Dynamic Rerouting Demo**:
   - Kembali ke peta utama.
   - Klik ruas jalan (edge) mana saja pada Canvas saat simulasi berjalan.
   - Jalan yang diblokir akan berwarna merah putus-putus. Seluruh kendaraan yang jalurnya terputus akan mencari rute alternatif secara *realtime* (*Dynamic Rerouting*).
5. **Stress Testing & Heatmap**:
   - Load graf stress test (misal 500 atau 1000 nodes).
   - Spawn **5.000 atau 10.000 kendaraan**.
   - Perhatikan *Live Traffic Heatmap* (jalan berubah warna dari hijau kekuningan hingga merah tebal berdasarkan tingkat kepadatan kendaraan).
6. **Data Export**:
   - Klik **Export Journey CSV** untuk mengunduh log perjalanan lengkap.
   - Klik **Export Graph JSON** untuk mengunduh konfigurasi koordinasi kota graf.
