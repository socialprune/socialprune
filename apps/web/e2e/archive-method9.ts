// A complete generated ZIP with one Deflate64 stored block. The expected
// method is encoded here, not read back from the production archive reader.
export function method9Zip(): Buffer {
  const name = Buffer.from('data/tweets.js');
  const content = Buffer.from(
    ['window', 'YTD', 'tweets', 'part0'].join('.') + ' = []',
  );
  const packed = Buffer.alloc(content.length + 5);
  packed[0] = 1;
  packed.writeUInt16LE(content.length, 1);
  packed.writeUInt16LE(~content.length & 0xffff, 3);
  content.copy(packed, 5);
  let crc = 0xffffffff;
  for (const byte of content) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(21, 4);
  local.writeUInt16LE(9, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(21, 4);
  central.writeUInt16LE(21, 6);
  central.writeUInt16LE(9, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(local.length + name.length + packed.length, 16);
  return Buffer.concat([local, name, packed, central, name, end]);
}
