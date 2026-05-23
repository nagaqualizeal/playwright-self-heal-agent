import { chromium } from 'playwright';
import fs from 'fs';

async function diagnoseAriaSnapshot() {
  console.log('🔍 Diagnostic: aria-snapshot() Analysis\n');
  
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Test with saucedemo.com - the site you're using
  console.log('📍 Target: https://www.saucedemo.com/');
  await page.goto('https://www.saucedemo.com/', { waitUntil: 'networkidle' });
  
  // Get aria-snapshot for the entire page
  console.log('\n📋 Extracting aria-snapshot()...');
  const ariaSnapshot = await page.locator('body').ariaSnapshot();
  
  console.log('\n✅ aria-snapshot captured. Analysis:\n');
  
  // Check 1: Does username field appear in aria-snapshot?
  const hasUsername = ariaSnapshot.includes('Username');
  console.log(`1️⃣  Username in aria-snapshot: ${hasUsername ? '✅ YES' : '❌ NO'}`);
  
  // Check 2: What textboxes exist?
  const textboxMatches = ariaSnapshot.match(/textbox[^}]*/g);
  console.log(`2️⃣  Textboxes found in tree: ${textboxMatches?.length || 0}`);
  if (textboxMatches) {
    textboxMatches.forEach((match, i) => console.log(`   [${i+1}] ${match.substring(0, 80)}`));
  }
  
  // Check 3: What buttons exist?
  const buttonMatches = ariaSnapshot.match(/button[^}]*/g);
  console.log(`\n3️⃣  Buttons found in tree: ${buttonMatches?.length || 0}`);
  if (buttonMatches) {
    buttonMatches.slice(0, 5).forEach((match, i) => console.log(`   [${i+1}] ${match.substring(0, 80)}`));
    if (buttonMatches.length > 5) console.log(`   ... and ${buttonMatches.length - 5} more`);
  }
  
  // Check 4: Try different locator strategies on actual element
  console.log('\n4️⃣  Testing actual element locators:\n');
  
  try {
    const byRole = page.getByRole('textbox', { name: 'Username' });
    const roleCount = await byRole.count();
    console.log(`   getByRole('textbox', { name: 'Username' }): ${roleCount} elements`);
    if (roleCount > 0) {
      const elem = await byRole.first().getAttribute('id');
      console.log(`      └─ Element ID: ${elem}`);
    }
  } catch (e) {
    console.log(`   getByRole('textbox', { name: 'Username' }): ERROR - ${(e as any).message}`);
  }
  
  try {
    const byPlaceholder = page.getByPlaceholder('Username');
    const placeholderCount = await byPlaceholder.count();
    console.log(`   getByPlaceholder('Username'): ${placeholderCount} elements`);
    if (placeholderCount > 0) {
      const elem = await byPlaceholder.first().getAttribute('id');
      console.log(`      └─ Element ID: ${elem}`);
    }
  } catch (e) {
    console.log(`   getByPlaceholder('Username'): ERROR - ${(e as any).message}`);
  }
  
  // Check 5: Raw DOM query
  console.log(`\n5️⃣  CSS selector tests:\n`);
  try {
    const userField = await page.$('[data-test="username"]');
    console.log(`   [data-test="username"]: ${userField ? '✅ FOUND' : '❌ NOT FOUND'}`);
  } catch (e) {
    console.log(`   [data-test="username"]: ERROR`);
  }
  
  try {
    const userField2 = await page.$('#user-name1234');
    console.log(`   #user-name1234: ${userField2 ? '✅ FOUND' : '❌ NOT FOUND'}`);
  } catch (e) {
    console.log(`   #user-name1234: ERROR`);
  }
  
  // Check 6: Save full aria-snapshot for inspection
  const reportPath = 'aria-snapshot-full.txt';
  fs.writeFileSync(reportPath, ariaSnapshot);
  console.log(`\n6️⃣  Full aria-snapshot saved to: ${reportPath}`);
  console.log(`   Size: ${(ariaSnapshot.length / 1024).toFixed(2)} KB`);
  
  // Check 7: Compare with raw page HTML
  console.log(`\n7️⃣  Page HTML analysis:\n`);
  const bodyHTML = await page.content();
  const hasUserInput = bodyHTML.includes('type="text"') || bodyHTML.includes('input');
  console.log(`   Input elements present: ${hasUserInput ? '✅ YES' : '❌ NO'}`);
  
  const usernameInHTML = bodyHTML.includes('Username') || bodyHTML.includes('username');
  console.log(`   "Username" text in HTML: ${usernameInHTML ? '✅ YES' : '❌ NO'}`);
  
  console.log('\n═'.repeat(60));
  console.log('📊 DIAGNOSIS COMPLETE');
  console.log('═'.repeat(60));
  
  await browser.close();
}

diagnoseAriaSnapshot().catch(console.error);
