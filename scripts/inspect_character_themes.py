"""Capture the three launch themes against the isolated local preview."""

from pathlib import Path

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:31141/"
OUTPUT = Path(r"C:\Users\BlueJack\AppData\Local\Temp")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for theme in ("roxy", "sylphiette", "eris"):
        page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
        errors: list[str] = []
        page.on("console", lambda message, bucket=errors: bucket.append(f"console:{message.type}:{message.text}") if message.type == "error" else None)
        page.on("pageerror", lambda error, bucket=errors: bucket.append(f"page:{error}"))
        page.add_init_script(f"localStorage.setItem('nova-wallpaper', '{theme}'); localStorage.setItem('pi-theme', 'dark');")
        page.goto(URL, wait_until="networkidle", timeout=30_000)
        page.locator(".chat-empty-launch-deck").wait_for(state="visible", timeout=15_000)
        page.wait_for_timeout(1_200)
        deck = page.locator(".chat-empty-launch-deck")
        composer = page.locator(".chat-empty-composer-frame .chat-composer-shell")
        print(theme, "deck", deck.bounding_box(), "composer", composer.bounding_box(), "errors", errors)
        if theme == "roxy":
            print("authoritative css loaded", page.evaluate("Array.from(document.styleSheets).some(function (sheet) { try { return Array.from(sheet.cssRules).some(function (rule) { return String(rule.cssText).includes('Authoritative launch-control geometry') || String(rule.selectorText || '').includes('body .chat-empty-state .chat-composer-shell .chat-composer-tools .chat-attach-button'); }); } catch (_) { return false; } })"))
            for selector in (".chat-attach-button", ".chat-model-config-trigger", ".chat-sound-button", ".chat-send-button"):
                control = page.locator(f".chat-empty-state {selector}")
                print(selector, control.bounding_box(), control.evaluate("element => ({ background: getComputedStyle(element).backgroundImage, zIndex: getComputedStyle(element).zIndex, opacity: getComputedStyle(element).opacity, filter: getComputedStyle(element).filter, authoritativeMatch: element.matches('html[data-wallpaper] body .chat-empty-state .chat-composer-shell .chat-composer-tools ' + (element.classList.contains('chat-attach-button') ? '.chat-attach-button' : element.classList.contains('chat-model-config-trigger') ? '.chat-model-config-trigger' : element.classList.contains('chat-sound-button') ? '.chat-sound-button' : '.chat-send-button')) })"))
        page.screenshot(path=OUTPUT / f"ranoa-theme-{theme}.png", full_page=True)
        if theme == "roxy":
            page.locator(".chat-model-config-trigger").click()
            page.locator(".chat-config-popover").wait_for(state="visible", timeout=5_000)
            page.keyboard.press("Escape")
            page.locator("button.new-session-context-chip.branch").click()
            page.locator(".new-session-branch-menu").wait_for(state="visible", timeout=5_000)
            textarea = page.locator(".chat-empty-composer-frame textarea")
            textarea.click()
            page.locator(".new-session-branch-menu").wait_for(state="hidden", timeout=5_000)
            textarea.fill("interaction check")
            assert page.locator(".chat-empty-composer-frame .chat-send-button").is_enabled()
            page.locator(".chat-empty-launch-deck").screenshot(path=OUTPUT / "ranoa-controls-enabled.png")
            textarea.fill("")
        registrations = page.evaluate("navigator.serviceWorker.getRegistrations().then(function (items) { return items.length; })")
        assert registrations == 0
        page.close()

    mobile = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1)
    mobile.add_init_script("localStorage.setItem('nova-wallpaper', 'roxy'); localStorage.setItem('pi-theme', 'dark');")
    mobile.goto(URL, wait_until="networkidle", timeout=30_000)
    mobile.locator(".chat-empty-launch-deck").wait_for(state="visible", timeout=15_000)
    mobile.wait_for_timeout(800)
    overflow = mobile.evaluate("document.documentElement.scrollWidth - window.innerWidth")
    mobile_deck = mobile.locator(".chat-empty-launch-deck")
    print("mobile-roxy", mobile_deck.bounding_box(), "horizontal-overflow", overflow, "frame", mobile_deck.evaluate("element => ({ background: getComputedStyle(element, '::after').backgroundImage, opacity: getComputedStyle(element, '::after').opacity, animation: getComputedStyle(element, '::after').animationName })"))
    mobile.screenshot(path=OUTPUT / "ranoa-theme-roxy-mobile.png", full_page=True)
    mobile.close()
    browser.close()
