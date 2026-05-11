## 2025-05-11 - [Middleware Database Queries]
**Learning:** Found an anti-pattern where a global middleware (`app.use`) performed a `Theme.findOne()` database query on every single request, including high-frequency API polling endpoints like `/api/director/pulse`.
**Action:** Always implement an in-memory cache (with a reasonable TTL, e.g., 5 minutes) for global configuration fetched from the database to prevent overwhelming the DB with redundant queries.
