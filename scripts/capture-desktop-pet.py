from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.home() / ".ranoa" / "previews" / "desktop-pet"
THEMES = {
    "roxy": "#111b37",
    "sylphiette": "#102b29",
    "eris": "#321715",
}
CHARACTERS = {
    "roxy": "洛琪希",
    "sylphiette": "希露菲",
    "eris": "爱丽丝",
}

OUTPUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 560, "height": 330}, device_scale_factor=1)
    page.goto((ROOT / "desktop" / "pet.html").as_uri())
    page.wait_for_load_state("networkidle")
    page.evaluate("""
      window.__petDragCalls = [];
      window.ranoaDesktop = {
        pet: {
          setBubbleOpen: async (open) => { window.__petDragCalls.push(['bubble', open]); return true; },
          startDrag: async (point) => { window.__petDragCalls.push(['start', point]); return true; },
          moveDrag: (point) => window.__petDragCalls.push(['move', point]),
          endDrag: () => window.__petDragCalls.push(['end']),
          reply: async () => true,
        },
      };
    """)
    page.evaluate("toggleBubble(true)")
    companion_box = page.locator(".companion-wrap").bounding_box()
    assert companion_box is not None
    drag_x = companion_box["x"] + companion_box["width"] * 0.55
    drag_y = companion_box["y"] + companion_box["height"] * 0.55
    page.mouse.move(drag_x, drag_y)
    page.mouse.down()
    page.mouse.move(drag_x - 42, drag_y - 28, steps=6)
    page.mouse.up()
    page.wait_for_timeout(520)
    drag_calls = page.evaluate("window.__petDragCalls")
    assert any(call[0] == "start" for call in drag_calls)
    assert any(call[0] == "move" for call in drag_calls)
    assert any(call[0] == "end" for call in drag_calls)
    assert not page.locator("body").evaluate("node => node.classList.contains('bubble-open')")
    for theme, background in THEMES.items():
        page.evaluate("theme => applyTheme(theme)", theme)
        page.wait_for_timeout(500)
        page.add_style_tag(content=f"html {{ background: {background} !important; }}")
        page.screenshot(path=str(OUTPUT / f"{theme}.png"))
        for state in ("working", "thinking", "tool", "error"):
            page.evaluate("state => setState(state)", state)
            page.wait_for_timeout(520)
            page.screenshot(path=str(OUTPUT / f"{theme}-{state}.png"))
        page.evaluate("activity => receiveActivity(activity)", {
            "sessionId": "visual-check",
            "text": "检查桌面伙伴状态，并让气泡跟随当前工作的任务。",
        })
        page.evaluate("setState('thinking')")
        page.evaluate("toggleBubble(true)")
        page.wait_for_timeout(280)
        assert page.locator("body").evaluate("node => node.classList.contains('bubble-open')")
        assert CHARACTERS[theme] in page.locator(".bubble-title").inner_text()
        assert "当前任务" in page.locator(".bubble-text").inner_text()
        page.screenshot(path=str(OUTPUT / f"{theme}-thinking-bubble.png"))
        page.evaluate("toggleBubble(false)")
        page.evaluate("message => receiveMessage(message)", {
            "sessionId": "visual-check",
            "text": "**任务已经完成。**\n\n- 整理了本轮修改\n- 检查了 `桌面窗口`、会话信息与交互状态",
        })
        page.evaluate("toggleBubble(true)")
        page.wait_for_timeout(280)
        assert page.locator("body").evaluate("node => node.classList.contains('bubble-open')")
        page.screenshot(path=str(OUTPUT / f"{theme}-bubble.png"))
        page.evaluate("toggleBubble(false)")
    browser.close()

print(OUTPUT)
