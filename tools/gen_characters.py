#!/usr/bin/env python3
"""Gera os 24 personagens do tema Clássico (SVG) + traits.json.

Uso: python3 tools/gen_characters.py
Saída: app/static/characters/classic/<slug>.svg e traits.json
"""
import itertools
import json
import math
import os
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "app", "static", "characters", "classic")

INK = "#1B1446"

BG = ["#FFE7A3", "#BFF0EA", "#FFD3C2", "#DCD3FF", "#FFD0DD", "#D6F5C9"]

SKIN = {  # tom: (pele, sombra)
    1: ("#FCE3CF", "#EFC3A6"),
    2: ("#F3C9A1", "#E2A97E"),
    3: ("#DDA67A", "#C68A5E"),
    4: ("#BF8158", "#A56A44"),
    5: ("#93593A", "#7B472C"),
    6: ("#663C26", "#53301D"),
}
SKIN_NAME = {1: "muito clara", 2: "clara", 3: "morena clara", 4: "morena", 5: "escura", 6: "muito escura"}

HAIR = {  # cor: (cabelo, sobrancelha)
    "preto": ("#2B2233", "#2B2233"),
    "castanho": ("#7A4A26", "#5E3A1E"),
    "loiro": ("#F2C14E", "#C9962E"),
    "ruivo": ("#E2622F", "#B84A22"),
    "grisalho": ("#BFBAD3", "#8D88A3"),
}

EYES = {"azul": "#3A86FF", "castanho": "#7A4A26", "verde": "#2FA35A"}

SHIRT = {
    "vermelha": ("#FF5E5B", "#D9403E"),
    "azul": ("#3A86FF", "#2766CC"),
    "verde": ("#2EC4B6", "#1F9A8F"),
    "amarela": ("#FFC93C", "#E0A818"),
    "roxa": ("#8A6CFF", "#6A4FDB"),
    "laranja": ("#FF9F5A", "#E07A35"),
}

HAT = {
    "vermelho": ("#FF5E5B", "#C9403E"),
    "azul": ("#3A86FF", "#2766CC"),
    "amarelo": ("#FFC93C", "#D9A21C"),
    "verde": ("#2EC4B6", "#1F9A8F"),
    "roxo": ("#8A6CFF", "#6A4FDB"),
}

# slug, gen, pele, cabelo(cor|None), penteado, barba, bigode, oculos, chapeu, cor_chapeu,
# brincos, olhos, bochechas, sorriso, camisa, gravata, cor_pelos_faciais(careca)
C = [
    ("ana", "F", 1, "ruivo", "liso_longo", 0, 0, 0, None, None, 1, "verde", 1, "aberto", "verde", None),
    ("bruno", "M", 4, "preto", "curto", 1, 1, 0, "bone", "vermelho", 0, "castanho", 0, "fechado", "azul", None),
    ("carla", "F", 5, "preto", "cacheado_longo", 0, 0, 1, None, None, 1, "castanho", 0, "aberto", "amarela", None),
    ("davi", "M", 3, "castanho", "cacheado_curto", 0, 0, 1, None, None, 0, "azul", 1, "fechado", "vermelha", "gravata"),
    ("elisa", "F", 2, "loiro", "rabo", 0, 0, 0, "chapeu", "amarelo", 0, "azul", 1, "fechado", "roxa", None),
    ("fabio", "M", 3, None, "careca", 0, 1, 0, None, None, 0, "castanho", 0, "aberto", "laranja", "gravata", "preto"),
    ("gabi", "F", 6, "preto", "cacheado_curto", 0, 0, 0, None, None, 1, "castanho", 0, "aberto", "azul", None),
    ("heitor", "M", 1, None, "careca", 1, 0, 1, None, None, 0, "azul", 0, "fechado", "verde", None, "grisalho"),
    ("iara", "F", 4, "castanho", "liso_longo", 0, 0, 0, "bone", "azul", 0, "verde", 0, "aberto", "laranja", None),
    ("joao", "M", 5, "preto", "curto", 0, 0, 0, "bone", "amarelo", 0, "castanho", 0, "aberto", "vermelha", None),
    ("karina", "F", 3, "ruivo", "coque", 0, 0, 1, None, None, 1, "verde", 1, "fechado", "azul", "borboleta"),
    ("leo", "M", 2, "loiro", "curto", 0, 0, 0, None, None, 1, "azul", 1, "aberto", "amarela", None),
    ("marta", "F", 5, "grisalho", "coque", 0, 0, 1, None, None, 0, "castanho", 0, "fechado", "roxa", None),
    ("nico", "M", 4, "ruivo", "cacheado_curto", 0, 0, 0, None, None, 0, "verde", 0, "aberto", "roxa", None),
    ("olga", "F", 1, "grisalho", "chanel", 0, 0, 1, "chapeu", "roxo", 0, "azul", 1, "fechado", "vermelha", None),
    ("paulo", "M", 6, None, "careca", 1, 0, 0, None, None, 0, "castanho", 0, "aberto", "verde", "gravata", "preto"),
    ("quim", "M", 3, "grisalho", "liso_longo", 1, 1, 0, "chapeu", "verde", 0, "verde", 0, "fechado", "amarela", None),
    ("rita", "F", 2, "ruivo", "liso_longo", 0, 0, 0, None, None, 0, "castanho", 1, "aberto", "roxa", "borboleta"),
    ("sofia", "F", 6, "castanho", "rabo", 0, 0, 0, None, None, 1, "castanho", 0, "aberto", "laranja", None),
    ("teo", "M", 1, "loiro", "cacheado_curto", 0, 0, 1, None, None, 0, "verde", 1, "aberto", "azul", "borboleta"),
    ("ulisses", "M", 5, "grisalho", "curto", 1, 1, 0, None, None, 0, "castanho", 0, "fechado", "laranja", None),
    ("vera", "F", 4, "loiro", "cacheado_longo", 0, 0, 0, None, None, 1, "azul", 0, "fechado", "verde", None),
    ("wesley", "M", 2, None, "careca", 0, 1, 0, None, None, 1, "castanho", 0, "aberto", "vermelha", "gravata", "castanho"),
    ("yara", "F", 6, "castanho", "chanel", 0, 0, 1, None, None, 0, "verde", 0, "aberto", "amarela", "borboleta"),
]

FIELDS = ["slug", "gen", "pele", "cabelo", "penteado", "barba", "bigode", "oculos", "chapeu", "cor_chapeu",
          "brincos", "olhos", "bochechas", "sorriso", "camisa", "gravata", "pelos"]


def f(v):
    s = ("%.1f" % v).rstrip("0").rstrip(".")
    return s if s != "-0" else "0"


def blob_circles(points, r, fill):
    return "".join('<circle cx="%s" cy="%s" r="%s"/>' % (f(x), f(y), f(r)) for x, y in points)


def arc_points(cx, cy, rx, ry, a0, a1, n):
    pts = []
    for i in range(n):
        a = math.radians(a0 + (a1 - a0) * i / (n - 1))
        pts.append((cx + rx * math.cos(a), cy + ry * math.sin(a)))
    return pts


# Geometria base
FCX, FCY, FRX, FRY = 100, 98, 42, 47  # rosto
EYE_Y = 100
EYE_L, EYE_R = 83, 117


def hair_back(style, col, hat):
    """Cabelo atrás da cabeça/ombros."""
    if style == "liso_longo":
        return '<path d="M50 168 C44 140 44 112 46 88 C48 34 152 34 154 88 C156 112 156 140 150 168 C134 176 66 176 50 168 Z" fill="%s"/>' % col
    if style == "cacheado_longo":
        pts = arc_points(100, 100, 56, 62, 150, 390, 15) + [(56, 158), (144, 158), (72, 166), (128, 166), (100, 168)]
        return '<g fill="%s"><ellipse cx="100" cy="108" rx="56" ry="60"/>%s</g>' % (col, blob_circles(pts, 17, col))
    if style == "chanel":
        return '<path d="M48 134 C46 110 46 96 48 84 C52 36 148 36 152 84 C154 96 154 110 152 134 C140 140 60 140 48 134 Z" fill="%s"/>' % col
    if style == "rabo":
        return ('<path d="M138 74 C170 70 176 118 162 150 C158 160 150 158 152 146 C158 120 154 96 136 92 Z" fill="%s"/>'
                '<rect x="136" y="72" width="12" height="16" rx="5" transform="rotate(-20 142 80)" fill="#FF7C9C"/>' % col)
    if style == "coque":
        return ('<circle cx="100" cy="42" r="20" fill="%s"/>' % col)
    return ""


def hair_front(style, col, hat):
    if style == "careca" or (hat and style in ("curto",)):
        if hat and style == "curto":
            return ('<path d="M57 98 C55 84 58 74 64 70 L68 92 Z M143 98 C145 84 142 74 136 70 L132 92 Z" fill="%s"/>' % col)
        return ""
    if style == "curto":
        return ('<path d="M56 96 C50 50 72 40 100 40 C130 40 152 52 144 96 C140 80 134 70 126 66 '
                'C112 74 86 74 70 66 C62 72 58 82 56 96 Z" fill="%s"/>' % col)
    if style == "cacheado_curto":
        pts = arc_points(100, 86, 46, 42, 175, 365, 11)
        return ('<g fill="%s"><path d="M58 86 C58 48 142 48 142 86 C130 70 70 70 58 86 Z"/>%s'
                '<circle cx="80" cy="60" r="14"/><circle cx="100" cy="56" r="15"/><circle cx="120" cy="60" r="14"/></g>'
                % (col, blob_circles(pts, 12, col)))
    if style == "cacheado_longo":
        if hat:
            return ""
        pts = arc_points(100, 84, 44, 38, 185, 355, 8)
        return '<g fill="%s">%s<path d="M58 84 C58 50 142 50 142 84 C126 66 74 66 58 84 Z"/></g>' % (col, blob_circles(pts, 13, col))
    if style in ("liso_longo", "chanel"):
        if hat:
            return ('<path d="M56 74 L54 140 C60 128 62 110 62 76 Z M144 74 L146 140 C140 128 138 110 138 76 Z" fill="%s"/>' % col)
        return ('<path d="M54 110 C48 50 70 44 100 44 C132 44 152 52 146 110 C142 92 140 80 132 70 '
                'C118 80 94 82 78 72 C66 80 60 92 54 110 Z" fill="%s"/>' % col)
    if style in ("coque", "rabo"):
        if hat:
            return ""
        return ('<path d="M57 92 C52 52 74 46 100 46 C126 46 148 52 143 92 C138 72 124 62 100 62 C76 62 62 72 57 92 Z" fill="%s"/>' % col)
    return ""


def hat_svg(kind, color):
    c, d = HAT[color]
    if kind == "bone":
        return ('<path d="M54 74 C52 30 148 30 146 74 Z" fill="%s"/>'
                '<path d="M50 74 C70 64 130 64 150 74 C152 82 148 86 140 84 C120 78 80 78 60 84 C52 86 48 82 50 74 Z" fill="%s"/>'
                '<circle cx="100" cy="34" r="5" fill="%s"/><path d="M100 36 V70" stroke="%s" stroke-width="3" fill="none"/>'
                % (c, d, d, d))
    # chapéu
    return ('<ellipse cx="100" cy="68" rx="68" ry="12" fill="%s"/>'
            '<path d="M64 68 C62 40 66 24 100 24 C134 24 138 40 136 68 Z" fill="%s"/>'
            '<path d="M63 56 H137 V66 H63 Z" fill="%s"/>' % (d, c, INK))


def eye(cx, color):
    return ('<ellipse cx="%d" cy="%d" rx="9" ry="9.5" fill="#fff"/>'
            '<circle cx="%d" cy="%d" r="6.2" fill="%s"/>'
            '<circle cx="%d" cy="%d" r="2.8" fill="%s"/>'
            '<circle cx="%s" cy="%s" r="1.6" fill="#fff"/>'
            % (cx, EYE_Y, cx, EYE_Y + 1, color, cx, EYE_Y + 1, INK, f(cx + 2), f(EYE_Y - 1.5)))


def character(d):
    skin, shade = SKIN[d["pele"]]
    hc = HAIR[d["cabelo"]][0] if d["cabelo"] else None
    facial = d["cabelo"] or d.get("pelos") or "preto"
    fcol, brow = HAIR[facial]
    shirt, shirt_d = SHIRT[d["camisa"]]
    hat = d["chapeu"]
    style = d["penteado"]
    p = []
    p.append('<rect width="200" height="200" fill="%s"/>' % d["bg"])
    if hc:
        p.append(hair_back(style, hc, hat))
    # camisa
    p.append('<path d="M26 200 C26 160 56 146 100 146 C144 146 174 160 174 200 Z" fill="%s"/>' % shirt)
    p.append('<path d="M70 150 L100 178 L130 150 C120 147 80 147 70 150 Z" fill="%s"/>' % shirt_d)
    # pescoço
    p.append('<path d="M84 128 H116 V152 L100 170 L84 152 Z" fill="%s"/>' % shade)
    if d["gravata"] == "gravata":
        p.append('<path d="M94 166 L100 160 L106 166 L102 172 L108 200 H92 L98 172 Z" fill="%s"/>' % INK)
    elif d["gravata"] == "borboleta":
        p.append('<path d="M100 166 L82 156 V178 Z M100 166 L118 156 V178 Z" fill="%s"/><circle cx="100" cy="166" r="5" fill="%s"/>' % (INK, INK))
    # orelhas
    p.append('<circle cx="58" cy="102" r="10" fill="%s"/><circle cx="142" cy="102" r="10" fill="%s"/>' % (skin, skin))
    # rosto
    p.append('<ellipse cx="%d" cy="%d" rx="%d" ry="%d" fill="%s"/>' % (FCX, FCY, FRX, FRY, skin))
    if style == "careca":
        p.append('<ellipse cx="84" cy="64" rx="12" ry="5" fill="#fff" opacity=".35" transform="rotate(-20 84 64)"/>')
    if d["bochechas"]:
        p.append('<g fill="#FF7C9C" opacity=".5"><ellipse cx="73" cy="118" rx="9" ry="5.5"/><ellipse cx="127" cy="118" rx="9" ry="5.5"/></g>')
    if d["barba"]:
        p.append('<path fill-rule="evenodd" d="M57 104 C58 160 142 160 143 104 C138 116 132 122 122 120 '
                 'C112 116 88 116 78 120 C68 122 62 116 57 104 Z M100 120 m-17 9 a17 9 0 1 0 34 0 a17 9 0 1 0 -34 0 Z" fill="%s"/>' % fcol)
    # olhos
    ec = EYES[d["olhos"]]
    p.append(eye(EYE_L, ec) + eye(EYE_R, ec))
    # sobrancelhas
    p.append('<path d="M74 85 Q83 80 91 85 M109 85 Q117 80 126 85" stroke="%s" stroke-width="4" stroke-linecap="round" fill="none"/>' % brow)
    # nariz
    p.append('<path d="M100 104 Q95 114 100 116 Q104 117 106 114" stroke="%s" stroke-width="3" stroke-linecap="round" fill="none"/>' % shade)
    # boca
    if d["sorriso"] == "aberto":
        p.append('<path d="M84 126 Q100 128 116 126 Q114 144 100 144 Q86 144 84 126 Z" fill="%s"/>'
                 '<path d="M87 127 Q100 129 113 127 L112 131 Q100 133 88 131 Z" fill="#fff"/>'
                 '<path d="M92 140 Q100 134 108 140 Q100 145 92 140 Z" fill="#FF7C9C"/>' % INK)
    else:
        p.append('<path d="M87 128 Q100 138 113 128" stroke="%s" stroke-width="4" stroke-linecap="round" fill="none"/>' % INK)
    if d["bigode"]:
        p.append('<path d="M78 125 C82 113 96 113 100 119 C104 113 118 113 122 125 C114 120 106 121 100 124 C94 121 86 120 78 125 Z" fill="%s"/>' % fcol)
    if hc:
        p.append(hair_front(style, hc, hat))
    if d["oculos"]:
        p.append('<g fill="none" stroke="%s" stroke-width="3.5"><circle cx="%d" cy="%d" r="14"/><circle cx="%d" cy="%d" r="14"/>'
                 '<path d="M97 99 Q100 95 103 99 M69 98 L59 95 M131 98 L141 95" stroke-linecap="round"/></g>'
                 % (INK, EYE_L, EYE_Y, EYE_R, EYE_Y))
    if hat:
        p.append(hat_svg(hat, d["cor_chapeu"]))
    if d["brincos"]:
        p.append('<g fill="#FFC93C" stroke="%s" stroke-width="2.5"><circle cx="55" cy="118" r="5.5"/><circle cx="145" cy="118" r="5.5"/></g>' % INK)
    body = "".join(p)
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">%s</svg>\n' % body


def traits(d):
    st = d["penteado"]
    return {
        "genero": "feminino" if d["gen"] == "F" else "masculino",
        "pele": d["pele"],
        "pele_nome": SKIN_NAME[d["pele"]],
        "cor_cabelo": d["cabelo"] or "nenhum",
        "penteado": st,
        "careca": st == "careca",
        "cabelo_comprido": st in ("liso_longo", "cacheado_longo"),
        "cabelo_cacheado": st in ("cacheado_curto", "cacheado_longo"),
        "cabelo_preso": st in ("coque", "rabo"),
        "barba": bool(d["barba"]),
        "bigode": bool(d["bigode"]),
        "oculos": bool(d["oculos"]),
        "chapeu": d["chapeu"] or "nenhum",
        "cor_chapeu": d["cor_chapeu"] or "nenhuma",
        "usa_chapeu_ou_bone": bool(d["chapeu"]),
        "brincos": bool(d["brincos"]),
        "cor_olhos": d["olhos"],
        "bochechas_rosadas": bool(d["bochechas"]),
        "sorriso_aberto": d["sorriso"] == "aberto",
        "cor_camisa": d["camisa"],
        "gravata": d["gravata"] or "nenhuma",
        "usa_gravata_ou_laco": bool(d["gravata"]),
        "fundo": d["bg"],
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    rows = []
    for i, t in enumerate(C):
        d = dict(zip(FIELDS, t))
        d.setdefault("pelos", None)
        d["bg"] = BG[(i + (i // 6)) % 6]
        rows.append(d)
    table = {}
    for d in rows:
        svg = character(d)
        assert len(svg) < 6000, (d["slug"], len(svg))
        with open(os.path.join(OUT, d["slug"] + ".svg"), "w") as fh:
            fh.write(svg)
        table[d["slug"]] = traits(d)
    with open(os.path.join(OUT, "traits.json"), "w") as fh:
        json.dump(table, fh, ensure_ascii=False, indent=2)
        fh.write("\n")

    # Relatório de equilíbrio
    keys = [k for k in next(iter(table.values())) if k not in ("fundo", "pele_nome")]
    for k in keys:
        cnt = Counter(str(v[k]) for v in table.values())
        print("%-20s %s" % (k, dict(sorted(cnt.items()))))
    qkeys = [k for k in keys if k not in ("penteado", "chapeu", "gravata")]
    mind = 99
    for a, b in itertools.combinations(table, 2):
        dist = sum(table[a][k] != table[b][k] for k in qkeys)
        if dist < mind:
            mind, pair = dist, (a, b)
    print("menor distância entre pares:", mind, pair)
    dists = Counter(sum(table[a][k] != table[b][k] for k in qkeys) for a, b in itertools.combinations(table, 2))
    print("distribuição de distâncias:", dict(sorted(dists.items())))


if __name__ == "__main__":
    main()
