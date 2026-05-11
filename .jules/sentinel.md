## 2024-05-24 - Unrestricted File Upload to Stored XSS
**Vulnerability:** The `multer` file upload configuration used `mimetype` to validate images, but preserved the original file extension without checking it. This allowed uploading files with a `image/png` mimetype but a `.html` extension, which were served from a static directory, leading to a Stored XSS vulnerability.
**Learning:** Checking `mimetype` is insufficient because it is controlled by the client and can easily be spoofed.
**Prevention:** Always validate file extensions using an allowlist on the backend before writing files to the disk.

## 2024-05-24 - Unauthorized Code Sharing
**Vulnerability:** Access codes used to start puzzles were not bound to any single device or user, allowing them to be shared and reused indefinitely on multiple devices.
**Learning:** Business logic vulnerabilities can be just as impactful as technical vulnerabilities. Without binding an access token (code) to a unique identifier (like a device ID), authorization checks can be bypassed by sharing the token.
**Prevention:** Bind single-use codes or limited-access tokens to a persistent client identifier (like a long-lived `deviceId` cookie) upon first use and verify this identifier on subsequent uses.
