// Exercise the progressive disclosure, as a user would, before legacy field checks.
export async function showScheduleSettings(page) {
 const panel=page.locator('#viewer-schedule');
 await panel.waitFor({state:'attached'});
 if(!await panel.isVisible() && await page.locator('#browse-records').isVisible())await page.locator('#browse-records').click();
 if(!await panel.evaluate(el=>el.open))await panel.locator(':scope > summary').click();
}
export async function showAdvancedRegistration(page) {
 const panel=page.locator('#add-advanced');
 if(!await panel.evaluate(el=>el.open))await panel.locator(':scope > summary').click();
}
export async function showRecordBrowser(page) {
 if(!await page.locator('.timeline-section').isVisible() && await page.locator('#browse-records').isVisible())await page.locator('#browse-records').click();
}
export async function closeRecordBrowser(page) {
 if(await page.locator('#record-browser').evaluate(el=>el.open))await page.locator('#close-records').click();
}
