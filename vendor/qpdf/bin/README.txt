Drop qpdf here to enable automatic PDF password removal.

WHAT TO DOWNLOAD
----------------
Go to: https://github.com/qpdf/qpdf/releases/latest
Download the file named like: qpdf-12.x.x-bin-msvc64.zip
(Pick the "msvc64" Windows build, not the source zip.)

WHAT TO EXTRACT
---------------
GOTCHA: the qpdf zip has TWO "bin" folders. The top-level one only has
"qtest-driver" — that's the test runner, NOT what you want. The actual
qpdf.exe is inside a nested "qpdf/bin/" folder:

  qpdf-12.x.x-bin-msvc64/
    bin/                        <-- DO NOT USE (just qtest-driver here)
      qtest-driver
    qpdf/                       <-- USE THIS ONE
      bin/
        qpdf.exe                <-- the actual executable
        qpdf29.dll              <-- DLL name has the qpdf major version
        libcrypto-3-x64.dll     (or similar)
        ... other .dll files ...
      include/
      lib/
      share/

Copy the CONTENTS of qpdf-12.x.x-bin-msvc64\qpdf\bin\ into THIS folder
so it ends up looking like:

  H:\IT-Downloader\vendor\qpdf\bin\
    qpdf.exe
    qpdf29.dll
    libcrypto-3-x64.dll
    ... etc ...
    README.txt   <-- this file

(All the .dll files must sit next to qpdf.exe.)

VERIFY IT WORKS
---------------
Open PowerShell and run:
  H:\IT-Downloader\vendor\qpdf\bin\qpdf.exe --version

If you see "qpdf version 12.x.x" -- you're done. Next time you download
26AS / AIS / TIS, the activity log will say "unlocked filename.pdf".

ALTERNATIVE (system-wide install)
---------------------------------
Instead of putting qpdf here, you can install it system-wide:
  - Add the qpdf bin/ folder to Windows PATH, OR
  - Use Chocolatey:  choco install qpdf

automation/unlocker.js checks THIS folder first, then falls back to
whatever qpdf is on PATH.
