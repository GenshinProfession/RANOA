"""Convert image-generated checkerboard pet art into a real-alpha PNG.

The image generator occasionally paints a white/grey transparency grid into
the raster.  We remove only bright, low-chroma pixels connected to the canvas
edge, which preserves white costume details enclosed by the character outline.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def remove_connected_checkerboard(source: Path, destination: Path) -> None:
    image = cv2.imread(str(source), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"Unable to read image: {source}")

    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]
    # Both squares in the generated checkerboard are near-neutral and bright.
    # Generated checkerboards are neutral greys. Keep this deliberately strict:
    # pale skin, white sleeves and mint highlights must remain foreground.
    candidate = ((saturation <= 20) & (value >= 205)).astype(np.uint8)

    count, labels = cv2.connectedComponents(candidate, connectivity=8)
    border_labels = np.unique(
        np.concatenate((labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]))
    )
    border_labels = border_labels[border_labels != 0]
    background = np.isin(labels, border_labels).astype(np.uint8)

    # Feather the exact connected boundary without dilating into fine fingers,
    # hair strands or pale costume details.
    alpha = ((1.0 - background.astype(np.float32)) * 255.0)
    alpha = cv2.GaussianBlur(alpha, (3, 3), 0.55)
    alpha[background == 1] = 0

    rgba = cv2.cvtColor(image, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = np.clip(alpha, 0, 255).astype(np.uint8)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), rgba):
        raise SystemExit(f"Unable to write image: {destination}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    remove_connected_checkerboard(args.source, args.destination)


if __name__ == "__main__":
    main()
