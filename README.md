# AI Pedagogical Analysis Backend

Backend separe pour analyser les cours et sujets sans exposer les cles IA dans l'application Flutter.

## Installation

```powershell
cd C:\Users\MAHMOUD\Desktop\proj\ai_backend
npm install
copy .env.example .env
notepad .env
```

Ajoute au moins une cle IA dans `.env`, par exemple `OPENAI_API_KEY` ou `GEMINI_API_KEY`.

## Lancement

```powershell
npm start
```

Par defaut le serveur ecoute sur:

```text
http://localhost:8787
```

Pour tester depuis un telephone physique, utilise l'adresse IP du PC dans le meme Wi-Fi, par exemple:

```text
http://192.168.1.20:8787
```
