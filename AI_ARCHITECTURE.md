# Architecture IA scalable

## Flux principal

```text
APK Android
-> /api/routing/select-backend
-> backend IA reserve dans Supabase
-> /api/analyze-subject sur le backend choisi
-> Supabase: quotas, cles chiffrees, metadata cours
-> Cloudflare Pages ou R2: chunks de cours optimises
-> Provider LLM avec la cle personnelle de l'utilisateur
-> resultat retourne a l'application
```

## Installation backend

```powershell
cd C:\Users\MAHMOUD\Desktop\proj\ai_backend
npm install
copy .env.example .env
```

Remplir ensuite `.env` avec:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `COURSE_STORAGE_PROVIDER=cloudflare-pages`
- `COURSE_CONTENT_BASE_URL`
- `MASTER_ENCRYPTION_KEY`
- `BACKEND_ID`
- `BACKEND_TYPE`
- `BACKEND_PUBLIC_URL`

## Supabase

Executer `supabase/schema.sql` dans le SQL editor Supabase.

Ajouter au minimum un backend:

```sql
insert into backend_servers (
  id, name, type, url, enabled, status, daily_limit, max_concurrent, priority
) values (
  'backend-1',
  'Backend IA Principal',
  'render',
  'https://votre-backend.example.com',
  true,
  'healthy',
  1000,
  3,
  1
);
```

Ajouter les modules, cours et chunks dans:

- `modules`
- `courses`
- `course_chunks`

Les fichiers de cours doivent exister dans Cloudflare Pages, par exemple:

```text
courses/anatomie/course-001/chunks/chunk_001.txt
courses/anatomie/course-001/chunks/chunk_002.txt
```

`course_chunks.storage_path` doit contenir ce chemin.

## Tests backend

```powershell
cd C:\Users\MAHMOUD\Desktop\proj\ai_backend
npm test
```

## Routes principales

- `GET /health`
- `POST /api/routing/select-backend`
- `GET /api/ai-content/providers`
- `GET /api/ai-content/modules`
- `GET /api/ai-content/modules/:moduleId/courses`
- `POST /api/ai-key/test`
- `POST /api/ai-key/save`
- `POST /api/ai-key/delete`
- `POST /api/analyze-subject`

## Android

Build avec l'URL du router IA:

```powershell
flutter build apk --release --dart-define=AI_BACKEND_URL=https://votre-router.example.com
```

En local:

```powershell
flutter run -d chrome --dart-define=AI_BACKEND_URL=http://localhost:8787
```
