import { chromium } from 'playwright';
import fs from 'fs';

async function diagnoseAriaAndDOM() {
  console.log('🔍 Diagnostic: aria-snapshot vs actual DOM\n');
  
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Navigate to your test site (adjust URL as needed)
  console.log('📍 Loading your application...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' }).catch(() => {
    console.log('   ℹ️ Note: Adjust URL if needed');
  });
  
  // Get aria-snapshot
  console.log('\n1️⃣ ARIA-SNAPSHOT (Accessibility Tree):');
  const ariaSnapshot = await page.locator('body').ariaSnapshot();
  console.log(`   Captured ${ariaSnapshot.length} chars`);
  
  // Show what buttons are in aria-snapshot
  const buttonMatches = ariaSnapshot.match(/button[^}]*/g);
  console.log(`\n   Buttons in aria-snapshot: ${buttonMatches?.length || 0}`);
  if (buttonMatches) {
    buttonMatches.slice(0, 5).forEach((match, i) => {
      console.log(`   [${i+1}] ${match.substring(0, 100)}`);
    });
  }
  
  // Get actual DOM buttons
  console.log('\n2️⃣ ACTUAL DOM (Raw HTML):');
  const buttons = await page.locator('button').all();
  console.log(`   Total buttons on page: ${buttons.length}`);
  
  for (let i = 0; i < Math.min(5, buttons.length); i++) {
    const button = buttons[i];
    const text = await button.textContent();
    const ariaLabel = await button.getAttribute('aria-label');
    const dataTestId = await button.getAttribute('data-testid');
    const id = await button.getAttribute('id');
    
    console.log(`\n   Button ${i+1}:`);
    console.log(`      Text: "${text}"`);
    console.log(`      Aria-Label: "${ariaLabel}"`);
    console.log(`      Data-TestId: "${dataTestId}"`);
    console.log(`      ID: "${id}"`);
  }
  
  // Check specific elements from your tests
  console.log('\n3️⃣ SEARCHING FOR YOUR SPECIFIC ELEMENTS:');
  
  // Chat button
  const chatButton = await page.locator('#chat-bot-launcher-button').count();
  console.log(`\n   #chat-bot-launcher-button: ${chatButton} found`);
  if (chatButton === 0) {
    // Search for similar buttons
    const launchChatbot = await page.locator('button:has-text("Launch Chatbot")').count();
    const chatBtn = await page.locator('button:has-text("Chat")').count();
    const anyChat = await page.locator('text=chat').count();
    console.log(`      ├─ button with "Launch Chatbot": ${launchChatbot}`);
    console.log(`      ├─ button with "Chat": ${chatBtn}`);
    console.log(`      └─ anything with "chat" text: ${anyChat}`);
  }
  
  // Username field
  const userField = await page.locator('#user-name1234').count();
  console.log(`\n   #user-name1234: ${userField} found`);
  if (userField === 0) {
    const byRole = await page.getByRole('textbox', { name: 'Username' }).count();
    const byPlaceholder = await page.getByPlaceholder('Username').count();
    const byId = await page.locator('#user-name').count();
    console.log(`      ├─ getByRole('textbox', { name: 'Username' }): ${byRole}`);
    console.log(`      ├─ getByPlaceholder('Username'): ${byPlaceholder}`);
    console.log(`      └─ #user-name: ${byId}`);
  }
  
  // Save full aria-snapshot
  fs.writeFileSync('full-aria-snapshot.txt', ariaSnapshot);
  console.log('\n📄 Full aria-snapshot saved to: full-aria-snapshot.txt');
  
  // Save full DOM
  const html = await page.content();
  fs.writeFileSync('full-dom.html', html);
  console.log('📄 Full DOM saved to: full-dom.html');
  
  console.log('\n═'.repeat(60));
  console.log('✅ Diagnostic complete');
  console.log('═'.repeat(60));
  
  await browser.close();
}

diagnoseAriaAndDOM().catch(console.error);
