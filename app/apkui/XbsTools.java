package org.golang.todo.xbs;

import java.io.UnsupportedEncodingException;

/**
 * XBS file format (byte-compatible with xbstools/xbstools.go):
 * the payload is an XXTEA-encrypted JSON document; the last 4 bytes of the
 * plaintext hold the original length (little-endian) so trailing padding
 * can be stripped.
 */
final class XbsTools {

    private static final byte[] XX_TEA_KEY = {
            (byte) 0xe5, (byte) 0x87, (byte) 0xbc, (byte) 0xe8,
            (byte) 0xa4, (byte) 0x86, (byte) 0xe6, (byte) 0xbb,
            (byte) 0xbf, (byte) 0xe9, (byte) 0x87, (byte) 0x91,
            (byte) 0xe6, (byte) 0xba, (byte) 0xa1, (byte) 0xe5};

    private XbsTools() {
    }

    static byte[] json2xbs(byte[] json) {
        int bufferLen = json.length;
        int n = (bufferLen & 3) == 0 ? bufferLen >> 2 : (bufferLen >> 2) + 1;
        byte[] padded = new byte[(n << 2) + 4];
        System.arraycopy(json, 0, padded, 0, bufferLen);
        int tail = n << 2;
        padded[tail] = (byte) (bufferLen & 0xFF);
        padded[tail + 1] = (byte) ((bufferLen >> 8) & 0xFF);
        padded[tail + 2] = (byte) ((bufferLen >> 16) & 0xFF);
        padded[tail + 3] = (byte) ((bufferLen >> 24) & 0xFF);
        return XXTEA.encrypt(padded, XX_TEA_KEY);
    }

    static String xbs2json(byte[] buffer) throws Exception {
        if (buffer.length < 8) {
            throw new Exception("输入数据过短（至少需要 8 字节）");
        }
        byte[] out = XXTEA.decrypt(buffer, XX_TEA_KEY);
        int n = buffer.length - 4;
        if (n > out.length - 4) {
            throw new Exception("解密后数据异常");
        }
        int m = (out[n] & 0xFF) | ((out[n + 1] & 0xFF) << 8)
                | ((out[n + 2] & 0xFF) << 16) | ((out[n + 3] & 0xFF) << 24);
        if (m < n - 3 || m > n) {
            throw new Exception("decode error");
        }
        try {
            return new String(out, 0, m, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            throw new Exception("UTF-8 不支持", e);
        }
    }
}
