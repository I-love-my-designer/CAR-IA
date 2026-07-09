# Security Specification for `car_jobs`

This document details the Zero-Trust security invariants, validation rules, and threat vectors for the `car_jobs` Firestore collection.

## 1. Zero-Trust Data Invariants
1. **Creation Lockdown**: Newly created jobs must have a status of exactly `'pending'`. Any other starting status (e.g. `'completed'`) is strictly forbidden.
2. **Client Immutability**: Once a job is created, the client can never modify the input files (`imageBackground`, `imageVehicle`, `imagePreviewRef`) or parameters (`rotation`, `createdAt`).
3. **Transition Integrity**: Only state advancement and backend update fields (`status`, `processedAt`, `imageFinal`, `errorMessage`) are modifiable during job updates.
4. **Denial of Wallet Protection**: Maximum payload sizes are tightly enforced on the Base64 image fields to prevent database bloating attacks.
5. **No Blind Deletion**: Deletion of jobs by client SDKs is strictly not allowed to preserve generation logs and billing trace history.
6. **No Arbitrary Listing**: Mass collection read requests (`list`) are disabled to prevent competitor scraping.

---

## 2. The "Dirty Dozen" Threat Payloads (Test Suite Cases)

Here are 12 specific payloads designed to breach identity, integrity, or structure, and their required response (`PERMISSION_DENIED`):

1. **Payload 1: Pre-Completed Creation** - Attempting to create a job containing `status: 'completed'`.
2. **Payload 2: Missing Core Field** - Attempting to create a job without `imagePreviewRef`.
3. **Payload 3: Maliciously Oversized Background Image** - Background string greater than allowed 450KB limit.
4. **Payload 4: Client Self-Completed Update** - Attempting to bypass the AI generation queue by updating status directly from `'pending'` to `'completed'` and writing some `imageFinal`.
5. **Payload 5: Input Image Poisoning** - Attempting to update `imageVehicle` inside an existing job representation.
6. **Payload 6: Rotation Angle Injection** - Attempting to alter `rotation` on an active job.
7. **Payload 7: Invalid ID Injection** - Creating a job where the ID contains illegal characters (e.g., `job$id%123` or paths).
8. **Payload 8: Mass Scraping Attack** - Executing an unrestricted `list` query on `car_jobs` as a guest or standard client.
9. **Payload 9: Ghost Field Injection** - Adding a hidden field like `isAdmin: true` during update or creation.
10. **Payload 10: Timestamp Spoofing** - Forging `createdAt` with a static past/future date instead of Firestore `request.time`.
11. **Payload 11: Document Deletion** - Attempting to delete an active job document.
12. **Payload 12: Orphaned/Empty Data Fields** - Creating a job where base64 images are empty strings.

---

## 3. Threat-Validation Mapping Matrix

| Threat Vector / Payload | Target Method | Rule Gate Mechanism | Outcome |
|---|---|---|---|
| ID Poisoning | `get`, `create`, `update` | `isValidId(jobId)` | `PERMISSION_DENIED` |
| Image Bloating (DOW) | `create` | `.size() <= MAX` | `PERMISSION_DENIED` |
| Overwriting Raw Inputs | `update`| `incoming().imageBackground == existing().imageBackground` | `PERMISSION_DENIED` |
| State Shortcutting | `update` | `affectedKeys().hasOnly(['status', ...])` | `PERMISSION_DENIED` |
| Forged Timestamps | `create` | `incoming().createdAt == request.time` | `PERMISSION_DENIED` |
