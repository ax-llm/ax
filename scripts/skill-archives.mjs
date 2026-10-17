// Stable tar headers make the published archive digest reproducible across
// builds, machines, and source file modification times.
export function createSkillArchive(files) {
  const blocks = [];
  for (const [name, content] of Object.entries(files).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )) {
    if (
      !/^[\w./-]+$/.test(name) ||
      name.startsWith('/') ||
      name.split('/').includes('..') ||
      Buffer.byteLength(name) > 100
    ) {
      throw new Error(`Invalid skill archive path: ${name}`);
    }
    const bytes = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name);
    const octal = (value, start, length) =>
      header.write(
        `${value.toString(8).padStart(length - 1, '0')}\0`,
        start,
        length,
        'ascii'
      );
    octal(0o644, 100, 8);
    octal(0, 108, 8);
    octal(0, 116, 8);
    octal(bytes.length, 124, 12);
    octal(0, 136, 12);
    header.fill(32, 148, 156);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(
      `${checksum.toString(8).padStart(6, '0')}\0 `,
      148,
      8,
      'ascii'
    );
    blocks.push(
      header,
      bytes,
      Buffer.alloc((512 - (bytes.length % 512)) % 512)
    );
  }
  blocks.push(Buffer.alloc(1024));
  return portableGzip(Buffer.concat(blocks));
}

// zlib compression output changes between Node versions, even after fixing
// gzip's timestamps and OS byte. Emit standard uncompressed DEFLATE blocks
// with fixed boundaries so the committed artifact hash is runtime-independent.
function portableGzip(bytes) {
  const blocks = [Buffer.from([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 255])];
  for (let offset = 0; offset < bytes.length; offset += 65535) {
    const length = Math.min(65535, bytes.length - offset);
    const header = Buffer.alloc(5);
    header[0] = offset + length === bytes.length ? 1 : 0;
    header.writeUInt16LE(length, 1);
    header.writeUInt16LE(length ^ 0xffff, 3);
    blocks.push(header, bytes.subarray(offset, offset + length));
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(bytes), 0);
  trailer.writeUInt32LE(bytes.length >>> 0, 4);
  blocks.push(trailer);
  return Buffer.concat(blocks);
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
