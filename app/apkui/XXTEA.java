package org.golang.todo.xbs;

/**
 * XXTEA block cipher, byte-compatible with github.com/yang3yen/xxtea-go
 * (padding disabled, auto rounds = 6 + 52/n). Used by the XBS file format.
 */
final class XXTEA {

    private static final int DELTA = 0x9e3779b9;

    private static int mx(int y, int z, int p, int e, int sum, int[] key) {
        return (((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4)))
                ^ ((sum ^ y) + (key[(p & 3) ^ e] ^ z));
    }

    private static void btea(int[] v, int n, int[] key) {
        int rounds;
        int i = 0;
        int y, z, p, e, sum;
        if (n > 1) {
            rounds = 6 + 52 / n;
            z = v[n - 1];
            sum = 0;
            for (; ; ) {
                sum += DELTA;
                e = (sum >>> 2) & 3;
                for (p = 0; p < n - 1; p++) {
                    y = v[p + 1];
                    v[p] += mx(y, z, p, e, sum, key);
                    z = v[p];
                }
                y = v[0];
                v[n - 1] += mx(y, z, p, e, sum, key);
                z = v[n - 1];
                i++;
                if (i > rounds - 1) {
                    break;
                }
            }
        } else if (n < -1) {
            int un = -n;
            rounds = 6 + 52 / un;
            sum = rounds * DELTA;
            y = v[0];
            for (; ; ) {
                e = (sum >>> 2) & 3;
                for (p = un - 1; p > 0; p--) {
                    z = v[p - 1];
                    v[p] -= mx(y, z, p, e, sum, key);
                    y = v[p];
                }
                z = v[un - 1];
                v[0] -= mx(y, z, p, e, sum, key);
                y = v[0];
                sum -= DELTA;
                i++;
                if (i > rounds - 1) {
                    break;
                }
            }
        }
    }

    private static int[] bytesToUint32(byte[] in) {
        int[] out = new int[in.length >> 2];
        for (int i = 0; i < in.length; i++) {
            out[i >> 2] |= (in[i] & 0xFF) << ((i & 3) << 3);
        }
        return out;
    }

    private static byte[] uint32sToBytes(int[] in) {
        byte[] out = new byte[in.length * 4];
        for (int i = 0; i < in.length; i++) {
            out[4 * i] = (byte) (in[i] & 0xFF);
            out[4 * i + 1] = (byte) ((in[i] >> 8) & 0xFF);
            out[4 * i + 2] = (byte) ((in[i] >> 16) & 0xFF);
            out[4 * i + 3] = (byte) ((in[i] >> 24) & 0xFF);
        }
        return out;
    }

    static byte[] encrypt(byte[] data, byte[] key) {
        if (key.length != 16) {
            throw new IllegalArgumentException("need a 16-byte key");
        }
        if (data.length < 8 || (data.length & 3) != 0) {
            throw new IllegalArgumentException(
                    "data length must be a multiple of 4 bytes and must not be less than 8 bytes");
        }
        int aLen = data.length >> 2;
        int[] d = bytesToUint32(data);
        int[] k = bytesToUint32(key);
        btea(d, aLen, k);
        return uint32sToBytes(d);
    }

    static byte[] decrypt(byte[] data, byte[] key) {
        if (key.length != 16) {
            throw new IllegalArgumentException("need a 16-byte key");
        }
        int dLen = data.length;
        if ((dLen & 3) != 0 || dLen < 8) {
            throw new IllegalArgumentException(
                    "invalid data, data length is not a multiple of 4, or less than 8");
        }
        int aLen = dLen / 4;
        int[] d = bytesToUint32(data);
        int[] k = bytesToUint32(key);
        btea(d, -aLen, k);
        return uint32sToBytes(d);
    }
}
