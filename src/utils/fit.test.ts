import { describe, it, expect } from "vitest";
import { parseFitFile } from "./fit";

// Build a minimal but valid FIT byte stream: a 14-byte header, one `record`
// definition message, then N record data messages. Enough to exercise the real
// decode path (header, definition, LE fields, semicircles, altitude scale, HR).
const SEMI = 2 ** 31 / 180; // degrees → semicircles
function buildFit(points: { lat: number; lng: number; altM: number; hr: number; tFit: number; distM: number }[]) {
  const bytes: number[] = [];
  const u16 = (v: number) => { bytes.push(v & 0xff, (v >> 8) & 0xff); };
  const u32 = (v: number) => { bytes.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff); };

  // Definition: record (global 20), local 0, 6 fields.
  const def: number[] = [0x40, 0x00, 0x00, 0x14, 0x00, 6,
    253, 4, 0x86, // timestamp uint32
    0, 4, 0x85,   // position_lat sint32
    1, 4, 0x85,   // position_long sint32
    2, 2, 0x84,   // altitude uint16
    3, 1, 0x02,   // heart_rate uint8
    5, 4, 0x86];  // distance uint32

  const data: number[] = [];
  for (const b of def) data.push(b);
  const w32 = (v: number) => data.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const w16 = (v: number) => data.push(v & 0xff, (v >> 8) & 0xff);
  for (const p of points) {
    data.push(0x00); // data header, local 0
    w32(p.tFit);
    w32(Math.round(p.lat * SEMI) >>> 0);
    w32(Math.round(p.lng * SEMI) >>> 0);
    w16(Math.round((p.altM + 500) * 5));
    data.push(p.hr & 0xff);
    w32(Math.round(p.distM * 100));
  }

  const dataSize = data.length;
  // Header
  bytes.push(14, 0x10);
  u16(0x0100);          // profile version
  u32(dataSize);        // data size
  bytes.push(0x2e, 0x46, 0x49, 0x54); // ".FIT"
  u16(0);               // header CRC (unchecked)
  for (const b of data) bytes.push(b);
  u16(0);               // file CRC (unchecked)
  return new Uint8Array(bytes);
}

describe("parseFitFile", () => {
  it("decodes a GPS activity: route, distance, elevation, heart rate", () => {
    const t0 = 1_000_000_000; // arbitrary FIT-epoch seconds
    const buf = buildFit([
      { lat: 43.300, lng: -1.900, altM: 20, hr: 120, tFit: t0, distM: 0 },
      { lat: 43.301, lng: -1.900, altM: 30, hr: 130, tFit: t0 + 60, distM: 115 },
      { lat: 43.302, lng: -1.900, altM: 25, hr: 140, tFit: t0 + 120, distM: 230 },
    ]);
    const { run, error } = parseFitFile(buf);
    expect(error).toBeUndefined();
    expect(run).toBeDefined();
    expect(run!.points).toHaveLength(3);
    // ~111 m per 0.001° of latitude → ~0.22 km over the two segments.
    expect(run!.km).toBeGreaterThan(0.15);
    expect(run!.km).toBeLessThan(0.3);
    expect(run!.durationSec).toBe(120);
    expect(run!.hr).toBe(130);
    expect(run!.hrMax).toBe(140);
    expect(run!.elevation).toBeGreaterThan(0); // 20→30 climb recorded
    // First point round-trips to ~the input coordinates.
    const [lat, lng] = run!.points![0] as number[];
    expect(lat).toBeCloseTo(43.300, 3);
    expect(lng).toBeCloseTo(-1.900, 3);
  });

  it("rejects a non-FIT buffer", () => {
    const notFit = new Uint8Array([12, 0x10, 0, 0, 0, 0, 0, 0, 0x58, 0x58, 0x58, 0x58, 0, 0]);
    expect(parseFitFile(notFit).error).toBeTruthy();
  });

  it("rejects a too-small buffer", () => {
    expect(parseFitFile(new Uint8Array([1, 2, 3])).error).toBeTruthy();
  });
});
