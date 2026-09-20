import { createHash } from 'node:crypto';
// Authorize/read through MessageMedia before ranges, including 416 responses.
export function mediaResponse(req, res, file) {
  const size = file.bytes.length, etag = '"sha256-' + createHash('sha256').update(file.bytes).digest('hex') + '"';
  const headers = {
    'Content-Type': file.type, 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', ETag: etag,
    'Content-Disposition': "inline; filename*=UTF-8''" + encodeURIComponent(file.name),
  };
  let start = 0, end = size - 1, status = 200;
  if (req.headers.range && (!req.headers['if-range'] || req.headers['if-range'] === etag)) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    start = match ? Number(match[1]) : NaN;
    end = match?.[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.writeHead(416, {...headers, 'Content-Range': 'bytes */' + size, 'Content-Length': 0}); return res.end();
    }
    status = 206; headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  }
  res.writeHead(status, {...headers, 'Content-Length': end - start + 1});
  res.end(file.bytes.subarray(start, end + 1));
}
