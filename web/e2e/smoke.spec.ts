import { test, expect } from '@playwright/test';

// Skip this test by default until a dev server is available
test.skip;

test.describe('DEAD AIR smoke tests', () => {
  test('page loads with Turn it on button visible', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const button = await page.locator('#audio-gate');
    await expect(button).toBeVisible();
    await expect(button).toContainText('TURN IT ON');
  });

  test('clicking button dismisses gate and focuses dial', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const button = await page.locator('#audio-gate');
    const dial = await page.locator('#dial');

    // Button is visible, dial is hidden
    await expect(button).toBeVisible();
    await expect(dial).toBeHidden();

    // Click button
    await button.click();

    // Button is hidden, dial is visible and focused
    await expect(button).toBeHidden();
    await expect(dial).toBeVisible();
    await expect(dial).toBeFocused();
  });

  test('dialing to 1714 shows now-playing card', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const button = await page.locator('#audio-gate');
    const dial = await page.locator('#dial');
    const card = await page.locator('#now-playing');

    // Turn on the radio
    await button.click();
    await expect(dial).toBeVisible();

    // Simulate pointer drag to 1714 (center of dial range)
    const dialBox = await dial.boundingBox();
    if (!dialBox) throw new Error('Dial not found');

    // Calculate center position (1714 is approximately in the middle)
    const centerX = dialBox.x + dialBox.width / 2;
    const centerY = dialBox.y + dialBox.height / 2;

    // Drag to 1714
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX + 10, centerY);
    await page.mouse.up();

    // Wait a bit for the broadcast to join
    await page.waitForTimeout(1000);

    // Check that now-playing card is visible and contains NoBanks Nearby
    await expect(card).toContainText('NoBanks Nearby');
  });

  test('keyboard navigation works on dial', async ({ page }) => {
    await page.goto('http://localhost:5173');
    const button = await page.locator('#audio-gate');
    const dial = await page.locator('#dial');

    // Turn on the radio
    await button.click();
    await expect(dial).toBeVisible();

    // Focus dial and press arrow keys
    await dial.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');

    // Dial should still be focused
    await expect(dial).toBeFocused();
  });
});
