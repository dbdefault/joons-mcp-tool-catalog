const TRIMMABLE = /^[\p{White_Space}\p{Cc}\p{Cf}]$/u;

export function trimBoundary(text) {
  let start = 0;
  let end = text.length;
  while (start < end) {
    const cp = text.codePointAt(start);
    const size = cp > 0xffff ? 2 : 1;
    if (!TRIMMABLE.test(text.slice(start, start + size))) break;
    start += size;
  }
  while (end > start) {
    const last = text.charCodeAt(end - 1);
    const size = last >= 0xdc00 && last <= 0xdfff && end - start >= 2 && text.charCodeAt(end - 2) >= 0xd800 && text.charCodeAt(end - 2) <= 0xdbff ? 2 : 1;
    if (!TRIMMABLE.test(text.slice(end - size, end))) break;
    end -= size;
  }
  return text.slice(start, end);
}
