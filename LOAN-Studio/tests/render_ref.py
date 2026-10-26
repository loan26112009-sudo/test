"""Independent numpy reference of the Reframe 360 projection + filters, used to validate the GPU shader.

Usage: python3 -I render_ref.py gen <src.raw> <W> <H>
       python3 -I render_ref.py ref <src.raw> <W> <H> <params.json> <out.raw>
Raw files are x2rgb10le (little-endian uint32: R<<20 | G<<10 | B).
"""
import sys, json
import numpy as np

def pack(rgb10):
    r, g, b = (rgb10[..., i].astype(np.uint32) for i in range(3))
    return (r << 20) | (g << 10) | b

def unpack(words):
    return np.stack([(words >> 20) & 1023, (words >> 10) & 1023, words & 1023], -1).astype(np.float64) / 1023.0

def gen(path, W, H):
    rng = np.random.default_rng(7)
    y, x = np.mgrid[0:H, 0:W].astype(np.float64)
    r = 0.5 + 0.5 * np.sin(x / W * 2 * np.pi * 3) * np.cos(y / H * np.pi * 2)
    g = (y / H) ** 1.5
    b = 0.5 + 0.35 * np.sin((x + y) / 9.0) + 0.1 * rng.standard_normal((H, W))
    rgb = np.clip(np.stack([r, g, b], -1), 0, 1)
    pack(np.round(rgb * 1023).astype(np.uint32)).astype('<u4').tofile(path)

def rot(yaw, pitch, roll):
    d = np.pi / 180
    cy, sy = np.cos(yaw * d), np.sin(yaw * d)
    cp, sp = np.cos(pitch * d), np.sin(pitch * d)
    cr, sr = np.cos(roll * d), np.sin(roll * d)
    Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    Rp = np.array([[1, 0, 0], [0, cp, sp], [0, -sp, cp]])
    Rr = np.array([[cr, -sr, 0], [sr, cr, 0], [0, 0, 1]])
    return Ry @ Rp @ Rr

def fetch(img, xi, yi):
    H, W = img.shape[:2]
    over = yi < 0
    under = yi >= H
    yi = np.where(over, -1 - yi, np.where(under, 2 * H - 1 - yi, yi))
    xi = np.where(over | under, xi + W // 2, xi)
    yi = np.clip(yi, 0, H - 1)
    xi = np.mod(xi, W)
    return img[yi, xi]

def cr_w(t):
    t2, t3 = t * t, t * t * t
    return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2]

def lz(x):
    x = np.abs(x)
    a = np.pi * np.where(x < 1e-5, 1.0, x)
    v = 3 * np.sin(a) * np.sin(a / 3) / (a * a)
    return np.where(x < 1e-5, 1.0, np.where(x >= 3, 0.0, v))

def sample(img, u, v, filt):
    p = np.stack([u - 0.5, v - 0.5], -1)
    f = np.floor(p); t = p - f; i0 = f.astype(np.int64)
    if filt == 'bicubic':
        wx, wy = cr_w(t[..., 0]), cr_w(t[..., 1])
        acc = 0
        for j in range(4):
            for i in range(4):
                acc = acc + (wx[i] * wy[j])[..., None] * fetch(img, i0[..., 0] + i - 1, i0[..., 1] + j - 1)
        return acc
    if filt == 'lanczos':
        wx = [lz(t[..., 0] - (i - 2)) for i in range(6)]
        wy = [lz(t[..., 1] - (j - 2)) for j in range(6)]
        sx, sy = sum(wx), sum(wy)
        acc = 0
        for j in range(6):
            for i in range(6):
                acc = acc + (wx[i] * wy[j])[..., None] * fetch(img, i0[..., 0] + i - 2, i0[..., 1] + j - 2)
        return acc / (sx * sy)[..., None]
    raise ValueError(filt)

def lens_scale(fov, d):
    a = fov * 0.5 * np.pi / 180
    amax = (np.arccos(-d) if d <= 1 else np.arccos(-1 / d)) - 0.5 * np.pi / 180
    if d <= 1:
        a = min(a, amax)
        return np.sin(a) / (d + np.cos(a))
    if a <= amax:
        return np.sin(a) / (d + np.cos(a))
    return np.sin(amax) / (d + np.cos(amax)) * (1 + 4 * (a - amax) / amax)

def ref(src, W, H, params, out):
    img = unpack(np.fromfile(src, '<u4').reshape(H, W))
    ow, oh, ss = params['outW'], params['outH'], params['ss']
    d = params['dist']; s = lens_scale(params['fov'], d)
    R = rot(params['yaw'], params['pitch'], params['roll'])
    he = (1.0, oh / ow) if ow >= oh else (ow / oh, 1.0)
    acc = np.zeros((oh, ow, 3))
    for sy in range(ss):
        for sx in range(ss):
            yy, xx = np.mgrid[0:oh, 0:ow].astype(np.float64)
            qx = xx + (sx + 0.5) / ss; qy = yy + (sy + 0.5) / ss
            nx = (qx / ow * 2 - 1) * he[0]; ny = (1 - qy / oh * 2) * he[1]
            D = np.stack([nx * s, ny * s, np.ones_like(nx)], -1)
            D /= np.linalg.norm(D, axis=-1, keepdims=True)
            b = -d * D[..., 2]; disc = b * b - (d * d - 1)
            t = -b + np.sqrt(np.maximum(disc, 0))
            P = D * t[..., None]; P[..., 2] -= d
            w = P @ R.T
            lon = np.arctan2(w[..., 0], w[..., 2]); lat = np.arcsin(np.clip(w[..., 1], -1, 1))
            u = (lon / (2 * np.pi) + 0.5) * W; v = (0.5 - lat / np.pi) * H
            c = sample(img, u, v, params['filter'])
            c[disc < 0] = 0
            acc += c
    c = np.clip(acc / (ss * ss), 0, 1)
    pack(np.floor(c * 1023 + 0.5).astype(np.uint32)).astype('<u4').tofile(out)

if __name__ == '__main__':
    if sys.argv[1] == 'gen':
        gen(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]))
    else:
        ref(sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), json.load(open(sys.argv[5])), sys.argv[6])
