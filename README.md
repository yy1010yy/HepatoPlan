# HepatoPlan

HepatoPlan is a research and education prototype for exploring liver resection geometry and comparing voxel-derived measurements across saved plans.

## Monorepo layout

| Directory | Role |
| --- | --- |
| `backend/` | Offline Python case preparation, shared case schemas, and browser-side TypeScript volumetry. |
| `public/cases/` | Public case index and versioned assets for static hosting. |
| `frontend/` | Planned home for the web application. |
| `ml-backend/` | Reserved path if an ML service is added after the MVP. |

- [Backend setup](backend/README.md)
- [Product requirements](HepatoPlan%20Product%20Requirements.md)
- [Backend design](backend-design.md)
- [Backend task tracker](backend-tasks.md)
