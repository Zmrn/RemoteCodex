export function validateAccessKey(key) {
  if (typeof key !== "string" || !/^[A-Za-z0-9._~-]{16,128}$/.test(key))
    throw Error("访问密钥需要 16–128 个字符，可使用字母、数字和 . _ ~ -");
  return key;
}
