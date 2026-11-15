# Lettore PDF

Lettore PDF per Windows (e anche web): legge, cerca, annota, compila moduli, firma, organizza le pagine, oscura, confronta, esporta, comprime, aggiunge filigrane e numeri di pagina, firma digitalmente con certificato e fa l'OCR dei documenti scansionati (offline).

## Ottenere l'.exe con GitHub Actions

1. Crea un repository su GitHub e carica tutto il contenuto di questa cartella (compreso `package-lock.json` e la cartella nascosta `.github`).
2. Vai nella scheda **Actions**: il workflow «Compila Lettore PDF per Windows» parte da solo a ogni push (oppure premi **Run workflow**).
3. Al termine (circa 5-8 minuti) apri l'esecuzione e scarica l'artefatto **Lettore-PDF-Windows**: contiene
   - `Lettore-PDF-Setup-1.0.0.exe`: installer (sceglie la cartella, crea i collegamenti, associa i `.pdf`);
   - `Lettore-PDF-Portable-1.0.0.exe`: versione portatile, senza installazione.
4. Facoltativo: crea un tag `v1.0.1` e GitHub pubblicherà gli .exe nella sezione **Releases**.

Windows può mostrare «Windows ha protetto il PC» perché l'.exe non è firmato con un certificato di firma del codice: premi **Ulteriori informazioni → Esegui comunque**.

## Compilare sul proprio PC

Servono Node.js 20+ e npm.

    npm ci
    npm run dist      # crea l'installer in dist/
    npm start         # prova l'app senza creare l'installer

## Struttura

- `app/` sorgenti dell'interfaccia (JavaScript, CSS, HTML)
- `scripts/build-app.js` unisce tutto in `src/index.html` (un solo file, funziona anche offline nel browser)
- `scripts/prepare-ocr.js` copia il motore OCR (Tesseract) e le lingue italiano/inglese in `src/ocr`
- `main.js`, `preload.js` finestra desktop (Electron)

`src/index.html` è anche la versione web: si apre con un doppio clic nel browser (l'OCR funziona solo nella versione desktop).
