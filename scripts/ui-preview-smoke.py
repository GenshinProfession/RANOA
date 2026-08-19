from pathlib import Path

from playwright.sync_api import sync_playwright


BASE_URL = "http://127.0.0.1:31141"
SCREENSHOT = Path(".pi-harness-dev/ui-before.png")


def main() -> None:
    SCREENSHOT.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 960}, device_scale_factor=1)
        page.goto(BASE_URL, wait_until="domcontentloaded")
        try:
            page.wait_for_load_state("networkidle", timeout=8_000)
        except Exception:
            # Pi Web intentionally keeps lightweight polling requests alive;
            # DOMContentLoaded plus a short settle window is the stable point
            # for this visual smoke test.
            page.wait_for_timeout(1_000)
        page.screenshot(path=str(SCREENSHOT), full_page=True)
        print(f"title={page.title()}")
        print(f"body_chars={len(page.locator('body').inner_text())}")
        app_bg = page.locator(".app-shell").evaluate("el => getComputedStyle(el).backgroundImage")
        main_bg = page.locator(".app-shell-main").evaluate("el => getComputedStyle(el).backgroundColor")
        chat_bg = page.locator(".chat-window").evaluate("el => getComputedStyle(el).backgroundColor")
        print(f"wallpaper_status={page.request.get(BASE_URL + '/backgrounds/roxy-workbench.png').status}")
        print(f"app_background={app_bg}")
        print(f"main_background={main_bg}")
        print(f"chat_background={chat_bg}")
        print("buttons:")
        for text in page.locator("button").all_inner_texts()[:24]:
            print(f"- {text.strip()!r}")
        print(f"screenshot={SCREENSHOT.resolve()}")
        browser.close()


if __name__ == "__main__":
    main()
