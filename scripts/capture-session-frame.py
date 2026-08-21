from pathlib import Path
import json
import sys

from playwright.sync_api import sync_playwright


OUTPUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.home() / ".ranoa" / "previews" / "session-frame"
OUTPUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    # Match the Windows display scale used by the desktop app screenshots. The
    # geometry assertions stay in CSS pixels while the captured raster also
    # proves the ornament does not open seams at a fractional device scale.
    page = browser.new_page(viewport={"width": 1440, "height": 920}, device_scale_factor=1.25)
    page.goto("http://127.0.0.1:31141/")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".session-item")
    selected = page.locator(".session-item.is-selected")
    if selected.count() == 0:
        page.locator(".session-item").first.click()
        page.wait_for_timeout(350)
        selected = page.locator(".session-item.is-selected")
    card = selected.first if selected.count() else page.locator(".session-item").first
    card.scroll_into_view_if_needed()
    page.mouse.move(1000, 120)
    page.wait_for_timeout(250)
    metrics = card.evaluate("""node => {
      const style = getComputedStyle(node);
      const frame = getComputedStyle(node, '::before');
      const innerPlate = getComputedStyle(node, '::after');
      const box = node.getBoundingClientRect();
      const copyBox = node.querySelector('.session-item-title')?.parentElement?.getBoundingClientRect();
      return {
        wallpaper: document.documentElement.dataset.wallpaper || null,
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
        card: {
          margin: style.margin,
          padding: style.padding,
          border: style.border,
          borderRadius: style.borderRadius,
          overflow: style.overflow,
          aspectRatio: style.aspectRatio,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          boxShadow: style.boxShadow,
        },
        frame: {
          content: frame.content,
          inset: frame.inset,
          width: frame.width,
          height: frame.height,
          backgroundImage: frame.backgroundImage,
          backgroundSize: frame.backgroundSize,
          backgroundPosition: frame.backgroundPosition,
          borderImageSource: frame.borderImageSource,
          borderImageSlice: frame.borderImageSlice,
          borderImageWidth: frame.borderImageWidth,
          borderImageOutset: frame.borderImageOutset,
          borderImageRepeat: frame.borderImageRepeat,
          opacity: frame.opacity,
          zIndex: frame.zIndex,
          transform: frame.transform,
        },
        innerPlate: {
          content: innerPlate.content,
        },
        copyBox: copyBox ? { y: copyBox.y, height: copyBox.height } : null,
      };
    }""")
    assert metrics["frame"]["inset"] == "0px"
    assert abs(float(metrics["frame"]["width"].removesuffix("px")) - metrics["box"]["width"]) < 0.1
    assert abs(float(metrics["frame"]["height"].removesuffix("px")) - metrics["box"]["height"]) < 0.1
    assert metrics["card"]["aspectRatio"] == "1600 / 500"
    assert metrics["card"]["backgroundColor"] == "rgba(0, 0, 0, 0)"
    assert metrics["card"]["backgroundImage"] == "none"
    assert metrics["card"]["boxShadow"] == "none"
    assert metrics["innerPlate"]["content"] == "none"
    assert abs(metrics["box"]["width"] / metrics["box"]["height"] - 1600 / 500) < 0.01
    assert metrics["copyBox"] is not None
    card_center = metrics["box"]["y"] + metrics["box"]["height"] / 2
    copy_center = metrics["copyBox"]["y"] + metrics["copyBox"]["height"] / 2
    assert abs(card_center - copy_center) < 2
    assert metrics["frame"]["backgroundSize"] == "100% 100%"
    assert metrics["frame"]["borderImageSource"] == "none"
    (OUTPUT / "metrics.json").write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding="utf-8")
    card.screenshot(path=str(OUTPUT / "session-card.png"))
    original_theme = metrics["wallpaper"] or "roxy"
    for theme in ("roxy", "sylphiette", "eris"):
        page.evaluate("theme => { document.documentElement.dataset.wallpaper = theme; }", theme)
        page.wait_for_timeout(100)
        theme_image = card.evaluate("node => getComputedStyle(node, '::before').backgroundImage")
        assert f"session-frame-{theme}.png" in theme_image
        card.screenshot(path=str(OUTPUT / f"session-card-{theme}.png"))
    page.evaluate("theme => { document.documentElement.dataset.wallpaper = theme; }", original_theme)
    card.hover()
    page.wait_for_timeout(180)
    card.screenshot(path=str(OUTPUT / "session-card-hover.png"))
    page.locator(".app-shell-sidebar").screenshot(path=str(OUTPUT / "sidebar.png"))
    browser.close()

print(json.dumps(metrics, ensure_ascii=False))
