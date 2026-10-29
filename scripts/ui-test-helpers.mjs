// Exercise the progressive disclosure, as a user would, before legacy field checks.
export async function showScheduleSettings(page) {
 const panel=page.locator('#viewer-schedule');
 await panel.waitFor({state:'attached'});
 if(!await panel.evaluate(el=>el.open))await panel.locator(':scope > summary').click();
}
export async function showAdvancedRegistration(page) {
 const panel=page.locator('#add-advanced');
 if(!await panel.evaluate(el=>el.open))await panel.locator(':scope > summary').click();
}
