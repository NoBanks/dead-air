# Technology Stack

## Frontend & Runtime
- **Node.js** 22 (v22.x)
- **TypeScript** (strict mode)
- **Web Audio API** (browser audio engine)
- **Cloudflare Workers** (serverless compute)
- **Cloudflare R2** (object storage)

## Testing & Development
- **vitest** (unit testing, includes fast-check)
- **fast-check** (property-based testing)
- **ffmpeg** (audio processing, analysis, encoding)

## Architecture
- No frontend frameworks unless needed (minimal dependencies).
- Small, focused modules. Each file does one thing well.
- TypeScript first, strict compilation.
- Tree-shaken builds where possible.

## Key Constraints
- No runtime secrets in repo (use `.env` outside git).
- Audio files never committed (see `.gitignore`).
- All audio encoded to 256 kbps MP3, -14 LUFS music, -16 LUFS voice.
