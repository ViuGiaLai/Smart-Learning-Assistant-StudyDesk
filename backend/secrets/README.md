# Server secrets

Place the Firebase service account downloaded from
**Firebase Console → Project settings → Service accounts → Generate new private key**
here as:

```text
backend/secrets/firebase-service-account.json
```

Then point the backend at it:

```env
FIREBASE_CREDENTIALS_FILE=./secrets/firebase-service-account.json
```

Rules:

- This file grants admin access to Firebase Cloud Messaging. Never commit it,
  never copy it into `mobile/`, and never expose it through an API.
- `backend/secrets/*.json` is gitignored.
- The Docker Compose stack mounts this directory read-only; it is not copied
  into the image.
