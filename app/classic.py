"""Built-in "Clássico" (Classic) theme (24 original characters)."""
from __future__ import annotations

CLASSIC_ID = "classic"
CLASSIC_NAME = "Clássico"
CLASSIC_AUTHOR = "Cara a Cara"

_CLASSIC: list[tuple[str, str]] = [
    ("ana", "Ana"), ("bruno", "Bruno"), ("carla", "Carla"), ("davi", "Davi"),
    ("elisa", "Elisa"), ("fabio", "Fábio"), ("gabi", "Gabi"), ("heitor", "Heitor"),
    ("iara", "Iara"), ("joao", "João"), ("karina", "Karina"), ("leo", "Leo"),
    ("marta", "Marta"), ("nico", "Nico"), ("olga", "Olga"), ("paulo", "Paulo"),
    ("quim", "Quim"), ("rita", "Rita"), ("sofia", "Sofia"), ("teo", "Téo"),
    ("ulisses", "Ulisses"), ("vera", "Vera"), ("wesley", "Wesley"), ("yara", "Yara"),
]

CLASSIC_CHARACTERS: list[dict[str, str]] = [
    {"id": slug, "name": name, "image_url": f"/static/characters/classic/{slug}.svg"}
    for slug, name in _CLASSIC
]
