# Android Action Kernel — Use Cases

Real-world scenarios the agent can handle, organized by category. Each use case includes the goal you'd give the agent and the actions it would take.

---

## 1. Messaging & Communication

### 1.1 Send a WhatsApp Message

**Goal:** "Open WhatsApp, search for John, and send him 'Hey, are you free for lunch tomorrow?'"

**Agent flow:**
```
launch  → { package: "com.whatsapp" }
tap     → search icon
type    → "John"
tap     → John's contact in search results
tap     → message input field
type    → "Hey, are you free for lunch tomorrow?"
tap     → send button
done
```

### 1.2 Send a WhatsApp Message to an Unsaved Number

**Goal:** "Open WhatsApp, start a chat with +1-555-123-4567, and send 'Your order is ready for pickup'"

**Agent flow:**
```
launch  → { uri: "https://wa.me/15551234567" }
wait    → page loads
tap     → "Continue to chat" or message input
type    → "Your order is ready for pickup"
tap     → send button
done
```

### 1.3 Reply to the Latest SMS

**Goal:** "Open Messages, open the most recent conversation, and reply with 'Got it, thanks!'"

**Agent flow:**
```
launch  → { package: "com.google.android.apps.messaging" }
tap     → first conversation in the list
tap     → message input field
type    → "Got it, thanks!"
tap     → send button
done
```

### 1.4 Send an Email via Gmail

**Goal:** "Open Gmail, compose a new email to boss@company.com with subject 'Monthly Report' and body 'Please find the report attached. Let me know if you have questions.'"

**Agent flow:**
```
launch  → { package: "com.google.android.gm" }
tap     → compose (FAB button)
tap     → To field
type    → "boss@company.com"
enter
tap     → Subject field
type    → "Monthly Report"
tap     → body field
type    → "Please find the report attached. Let me know if you have questions."
tap     → send button
done
```

### 1.5 Make a Phone Call

**Goal:** "Call the number 555-987-6543"

**Agent flow:**
```
launch  → { uri: "tel:5559876543" }
tap     → call/dial button
done
```

### 1.6 Send a Telegram Message

**Goal:** "Open Telegram, search for the group 'Project Alpha', and send 'Build deployed to staging'"

**Agent flow:**
```
launch  → { package: "org.telegram.messenger" }
tap     → search icon
type    → "Project Alpha"
tap     → "Project Alpha" group in results
tap     → message input
type    → "Build deployed to staging"
tap     → send button
done
```

---

## 2. Social Media

### 2.1 Post an Instagram Story

**Goal:** "Open Instagram, go to the camera, take a photo, and post it as a story"

**Agent flow:**
```
launch  → { package: "com.instagram.android" }
tap     → camera icon / "Your Story" circle
tap     → shutter button (capture photo)
tap     → "Your Story" button to post
done
```

### 2.2 Like the First 5 Posts on Instagram Feed

**Goal:** "Open Instagram, scroll through the feed, and like the first 5 posts"

**Agent flow:**
```
launch  → { package: "com.instagram.android" }
tap     → heart icon on post 1
swipe   → { direction: "up" }
tap     → heart icon on post 2
swipe   → { direction: "up" }
tap     → heart icon on post 3
swipe   → { direction: "up" }
tap     → heart icon on post 4
swipe   → { direction: "up" }
tap     → heart icon on post 5
done
```

### 2.3 Post a Tweet / X Post

**Goal:** "Open X, compose a new post with 'Excited to announce our new product launch! #startup #launch'"

**Agent flow:**
```
launch  → { package: "com.twitter.android" }
tap     → compose button (floating + icon)
tap     → text input area
type    → "Excited to announce our new product launch! #startup #launch"
tap     → Post button
done
```

### 2.4 Follow an Account on Instagram

**Goal:** "Open Instagram, search for 'natgeo', and follow them"

**Agent flow:**
```
launch  → { package: "com.instagram.android" }
tap     → search tab (magnifying glass)
tap     → search bar
type    → "natgeo"
tap     → "natgeo" account in results
tap     → "Follow" button
done
```

### 2.5 Check LinkedIn Notifications

**Goal:** "Open LinkedIn and read the latest 3 notifications"

**Agent flow:**
```
launch  → { package: "com.linkedin.android" }
tap     → notifications tab (bell icon)
wait    → notifications load
screenshot → capture notifications for review
done    → { reason: "Top 3 notifications: 1) ... 2) ... 3) ..." }
```

---

## 3. Navigation & Maps

### 3.1 Get Directions to a Location

**Goal:** "Open Google Maps and get driving directions to San Francisco Airport"

**Agent flow:**
```
launch  → { uri: "https://maps.google.com/?q=San+Francisco+Airport" }
wait    → map loads
tap     → "Directions" button
tap     → driving mode icon
done
```

### 3.2 Find Nearby Restaurants

**Goal:** "Search for pizza restaurants near me on Google Maps"

**Agent flow:**
```
launch  → { uri: "geo:0,0?q=pizza+restaurants+near+me" }
wait    → results load
done    → { reason: "Showing nearby pizza restaurants on map" }
```

### 3.3 Share Current Location via WhatsApp

**Goal:** "Open WhatsApp, go to the chat with Mom, and share my current location"

**Agent flow:**
```
launch  → { package: "com.whatsapp" }
tap     → search icon
type    → "Mom"
tap     → Mom's chat
tap     → attachment icon (paperclip)
tap     → "Location"
tap     → "Share live location" or "Send your current location"
tap     → send button
done
```

### 3.4 Book an Uber

**Goal:** "Open Uber and request a ride to the airport"

**Agent flow:**
```
launch  → { package: "com.ubercab" }
tap     → "Where to?" search bar
type    → "Airport"
tap     → airport result from suggestions
tap     → ride option (UberX, Comfort, etc.)
tap     → "Confirm" / "Request" button
done
```

---

## 4. Device Settings & Configuration

### 4.1 Turn On Wi-Fi

**Goal:** "Enable Wi-Fi on the device"

**Agent flow:**
```
shell   → { command: "svc wifi enable" }
done
```

### 4.2 Toggle Airplane Mode

**Goal:** "Turn on airplane mode"

**Agent flow:**
```
shell   → { command: "settings put global airplane_mode_on 1" }
shell   → { command: "am broadcast -a android.intent.action.AIRPLANE_MODE" }
done
```

### 4.3 Set Screen Brightness to Maximum

**Goal:** "Set the screen brightness to maximum"

**Agent flow:**
```
shell   → { command: "settings put system screen_brightness 255" }
done
```

### 4.4 Change the Screen Timeout

**Goal:** "Set screen timeout to 5 minutes"

**Agent flow:**
```
shell   → { command: "settings put system screen_off_timeout 300000" }
done
```

### 4.5 Connect to a Wi-Fi Network

**Goal:** "Connect to the Wi-Fi network 'OfficeNet' with password 'secure123'"

**Agent flow:**
```
shell   → { command: "cmd wifi connect-network OfficeNet wpa2 secure123" }
done
```

### 4.6 Enable Do Not Disturb

**Goal:** "Turn on Do Not Disturb mode"

**Agent flow:**
```
launch  → { action: "android.settings.ZEN_MODE_SETTINGS" }
tap     → "Turn on now" or DND toggle
done
```

### 4.7 Change System Font Size

**Goal:** "Make the font size larger for better readability"

**Agent flow:**
```
shell   → { command: "settings put system font_scale 1.3" }
done
```

### 4.8 Disable Auto-Rotate

**Goal:** "Lock the screen to portrait orientation"

**Agent flow:**
```
shell   → { command: "settings put system accelerometer_rotation 0" }
done
```

---

## 5. App Management

### 5.1 Force Stop a Misbehaving App

**Goal:** "Force stop Facebook because it's draining battery"

**Agent flow:**
```
shell   → { command: "am force-stop com.facebook.katana" }
done
```

### 5.2 Clear an App's Cache

**Goal:** "Clear cache for Chrome to free up storage"

**Agent flow:**
```
shell   → { command: "pm clear com.android.chrome" }
done
```

### 5.3 List All Installed Third-Party Apps

**Goal:** "Show me all non-system apps installed on this device"

**Agent flow:**
```
shell   → { command: "pm list packages -3" }
done    → { reason: "Installed apps: com.whatsapp, com.instagram.android, ..." }
```

### 5.4 Grant Camera Permission to an App

**Goal:** "Grant camera permission to Zoom"

**Agent flow:**
```
shell   → { command: "pm grant us.zoom.videomeetings android.permission.CAMERA" }
done
```

### 5.5 Uninstall an App

**Goal:** "Uninstall TikTok"

**Agent flow:**
```
shell   → { command: "pm uninstall com.zhiliaoapp.musically" }
done
```

### 5.6 Install an APK from the Device

**Goal:** "Install the APK at /sdcard/Download/myapp.apk"

**Agent flow:**
```
shell   → { command: "pm install /sdcard/Download/myapp.apk" }
done
```

---

## 6. Productivity & Work

### 6.1 Set a Timer

**Goal:** "Set a timer for 10 minutes"

**Agent flow:**
```
launch  → { package: "com.google.android.deskclock" }
tap     → timer tab
tap     → 1, 0, 0, 0 (10:00 minutes)
tap     → start button
done
```

### 6.2 Set an Alarm

**Goal:** "Set an alarm for 7:30 AM tomorrow"

**Agent flow:**
```
launch  → { package: "com.google.android.deskclock" }
tap     → alarm tab
tap     → add alarm button (+)
tap     → 7 on the hour picker
tap     → 30 on the minute picker
tap     → AM
tap     → OK / save
done
```

### 6.3 Create a Calendar Event

**Goal:** "Open Google Calendar and create an event called 'Team Standup' for tomorrow at 10 AM"

**Agent flow:**
```
launch  → { package: "com.google.android.calendar" }
tap     → add event button (+)
tap     → title field
type    → "Team Standup"
tap     → date field
tap     → tomorrow's date
tap     → start time
tap     → 10:00 AM
tap     → save
done
```

### 6.4 Take a Screenshot and Save It

**Goal:** "Take a screenshot of whatever is on screen"

**Agent flow:**
```
screenshot → { filename: "capture_2024.png" }
done
```

### 6.5 Create a Note in Google Keep

**Goal:** "Open Google Keep and create a note titled 'Shopping List' with items: milk, eggs, bread, butter"

**Agent flow:**
```
launch  → { package: "com.google.android.keep" }
tap     → new note button (+)
tap     → title field
type    → "Shopping List"
tap     → note body
type    → "milk\neggs\nbread\nbutter"
back    → auto-saves
done
```

### 6.6 Check Battery Status

**Goal:** "What's the current battery level and status?"

**Agent flow:**
```
shell   → { command: "dumpsys battery" }
done    → { reason: "Battery level: 73%, status: charging, health: good, temp: 28°C" }
```

---

## 7. Media & Entertainment

### 7.1 Play a Song on Spotify

**Goal:** "Open Spotify, search for 'Bohemian Rhapsody' by Queen, and play it"

**Agent flow:**
```
launch  → { package: "com.spotify.music" }
tap     → search tab
tap     → search bar
type    → "Bohemian Rhapsody Queen"
tap     → first song result
tap     → play button
done
```

### 7.2 Play/Pause Current Media

**Goal:** "Pause whatever music is playing"

**Agent flow:**
```
shell   → { command: "input keyevent 85" }
done
```

### 7.3 Skip to Next Track

**Goal:** "Skip to the next song"

**Agent flow:**
```
shell   → { command: "input keyevent 87" }
done
```

### 7.4 Set Media Volume

**Goal:** "Set media volume to 80%"

**Agent flow:**
```
shell   → { command: "media volume --set 12 --stream 3" }
done
```

### 7.5 Open a YouTube Video

**Goal:** "Open YouTube and search for 'how to make pasta carbonara'"

**Agent flow:**
```
launch  → { package: "com.google.android.youtube" }
tap     → search icon
type    → "how to make pasta carbonara"
enter
tap     → first video result
done
```

### 7.6 Take and Review a Photo

**Goal:** "Open the camera, take a photo, and open it in the gallery"

**Agent flow:**
```
launch  → { action: "android.media.action.IMAGE_CAPTURE" }
tap     → shutter button
tap     → photo thumbnail / preview
done
```

---

## 8. Shopping & E-Commerce

### 8.1 Search for a Product on Amazon

**Goal:** "Open Amazon and search for 'wireless bluetooth headphones under $50'"

**Agent flow:**
```
launch  → { package: "com.amazon.mShop.android.shopping" }
tap     → search bar
type    → "wireless bluetooth headphones under $50"
enter
swipe   → { direction: "up" } (browse results)
done
```

### 8.2 Add an Item to Cart

**Goal:** "Open Amazon, search for 'USB-C cable', and add the first result to cart"

**Agent flow:**
```
launch  → { package: "com.amazon.mShop.android.shopping" }
tap     → search bar
type    → "USB-C cable"
enter
tap     → first product
swipe   → { direction: "up" } (scroll to Add to Cart)
tap     → "Add to Cart" button
done
```

### 8.3 Check Order Status

**Goal:** "Open Amazon and check my recent orders"

**Agent flow:**
```
launch  → { package: "com.amazon.mShop.android.shopping" }
tap     → profile/account icon
tap     → "Your Orders"
wait    → orders load
screenshot
done    → { reason: "Latest order: ... status: ..." }
```

### 8.4 Search for Food Delivery

**Goal:** "Open Uber Eats and search for sushi restaurants"

**Agent flow:**
```
launch  → { package: "com.ubercab.eats" }
tap     → search bar
type    → "sushi"
enter
wait    → results load
done
```

---

## 9. Information & Research

### 9.1 Google Search

**Goal:** "Search Google for 'best programming languages 2025'"

**Agent flow:**
```
launch  → { uri: "https://www.google.com/search?q=best+programming+languages+2025" }
wait    → results load
done
```

### 9.2 Check the Weather

**Goal:** "What's the weather like today?"

**Agent flow:**
```
launch  → { uri: "https://www.google.com/search?q=weather+today" }
wait    → weather card loads
screenshot
done    → { reason: "Current weather: 72°F, partly cloudy, high of 78°F" }
```

### 9.3 Translate Text

**Goal:** "Open Google Translate and translate 'Where is the nearest hospital?' to Spanish"

**Agent flow:**
```
launch  → { package: "com.google.android.apps.translate" }
tap     → input text field
type    → "Where is the nearest hospital?"
tap     → target language selector
tap     → "Spanish"
wait    → translation appears
done    → { reason: "Translation: ¿Dónde está el hospital más cercano?" }
```

### 9.4 Look Up a Word in the Dictionary

**Goal:** "Search for the definition of 'ephemeral'"

**Agent flow:**
```
launch  → { uri: "https://www.google.com/search?q=define+ephemeral" }
wait    → definition card loads
screenshot
done
```

### 9.5 Check Stock Prices

**Goal:** "What's the current stock price of Apple?"

**Agent flow:**
```
launch  → { uri: "https://www.google.com/search?q=AAPL+stock+price" }
wait    → stock card loads
screenshot
done    → { reason: "AAPL: $XXX.XX, up/down X.X%" }
```

---

## 10. File Management

### 10.1 List Files in Downloads

**Goal:** "Show me all files in the Downloads folder"

**Agent flow:**
```
shell   → { command: "ls -la /sdcard/Download/" }
done    → { reason: "Files: report.pdf, photo.jpg, ..." }
```

### 10.2 Move a File

**Goal:** "Move the file report.pdf from Downloads to Documents"

**Agent flow:**
```
shell   → { command: "mv /sdcard/Download/report.pdf /sdcard/Documents/" }
done
```

### 10.3 Delete Old Screenshots

**Goal:** "Delete all screenshots older than 30 days"

**Agent flow:**
```
shell   → { command: "find /sdcard/Pictures/Screenshots -mtime +30 -delete" }
done
```

### 10.4 Check Storage Usage

**Goal:** "How much storage space is left on the device?"

**Agent flow:**
```
shell   → { command: "df -h /sdcard" }
done    → { reason: "Storage: 64GB total, 42GB used, 22GB free" }
```

### 10.5 Create a Folder

**Goal:** "Create a new folder called 'Work Projects' in Documents"

**Agent flow:**
```
shell   → { command: "mkdir -p /sdcard/Documents/Work Projects" }
done
```

---

## 11. System Monitoring & Diagnostics

### 11.1 Check Which App is Using the Most Battery

**Goal:** "Find out what's draining the battery"

**Agent flow:**
```
launch  → { action: "android.intent.action.POWER_USAGE_SUMMARY" }
wait    → battery usage loads
screenshot
done    → { reason: "Top battery consumers: Screen 35%, Chrome 15%, WhatsApp 10%" }
```

### 11.2 Check Memory Usage

**Goal:** "How much RAM is being used?"

**Agent flow:**
```
shell   → { command: "dumpsys meminfo" }
done    → { reason: "Total RAM: 8GB, Used: 5.2GB, Free: 2.8GB" }
```

### 11.3 Check Running Processes

**Goal:** "What apps are currently running?"

**Agent flow:**
```
shell   → { command: "dumpsys activity activities" }
done    → { reason: "Foreground: Chrome. Background: WhatsApp, Spotify, Gmail" }
```

### 11.4 Get Device Information

**Goal:** "What device is this and what Android version is it running?"

**Agent flow:**
```
shell   → { command: "getprop ro.product.model" }
shell   → { command: "getprop ro.build.version.release" }
shell   → { command: "getprop ro.product.brand" }
done    → { reason: "Samsung Galaxy S24, Android 14, Brand: Samsung" }
```

### 11.5 Check Network Connectivity

**Goal:** "Am I connected to the internet?"

**Agent flow:**
```
shell   → { command: "ping -c 1 google.com" }
done    → { reason: "Connected. Ping to google.com: 23ms" }
```

### 11.6 Read Recent Crash Logs

**Goal:** "Check if any apps have crashed recently"

**Agent flow:**
```
shell   → { command: "logcat -d -b crash -t 20" }
done    → { reason: "Last crash: com.example.app at 2:30 PM — NullPointerException" }
```

---

## 12. Automation & Batch Operations

### 12.1 Morning Routine

**Goal:** "Run my morning routine: turn off DND, set brightness to 60%, open the weather, then open my calendar"

**Agent flow:**
```
shell   → { command: "settings put global zen_mode 0" }
shell   → { command: "settings put system screen_brightness 153" }
launch  → { uri: "https://www.google.com/search?q=weather+today" }
wait    → weather loads
screenshot
home
launch  → { package: "com.google.android.calendar" }
done
```

### 12.2 Night Mode Setup

**Goal:** "Set up the device for nighttime: reduce brightness to minimum, enable DND, set an alarm for 7 AM"

**Agent flow:**
```
shell   → { command: "settings put system screen_brightness 10" }
shell   → { command: "settings put global zen_mode 1" }
launch  → { package: "com.google.android.deskclock" }
tap     → alarm tab
tap     → add alarm (+)
tap     → 7:00 AM
tap     → save
done
```

### 12.3 Kill All Background Apps

**Goal:** "Close all background apps to free up memory"

**Agent flow:**
```
shell   → { command: "am kill-all" }
done    → { reason: "All background processes killed" }
```

### 12.4 Bulk Permission Grant

**Goal:** "Grant all necessary permissions to the new camera app com.newcam.app"

**Agent flow:**
```
shell   → { command: "pm grant com.newcam.app android.permission.CAMERA" }
shell   → { command: "pm grant com.newcam.app android.permission.RECORD_AUDIO" }
shell   → { command: "pm grant com.newcam.app android.permission.ACCESS_FINE_LOCATION" }
shell   → { command: "pm grant com.newcam.app android.permission.READ_MEDIA_IMAGES" }
done
```

### 12.5 Screen Recording Session

**Goal:** "Record the screen for 30 seconds"

**Agent flow:**
```
shell   → { command: "screenrecord --time-limit 30 /sdcard/recording.mp4" }
done    → { reason: "Screen recorded to /sdcard/recording.mp4" }
```

---

## 13. Accessibility & Assistance

### 13.1 Read Screen Content Aloud

**Goal:** "Read what's currently on screen"

**Agent flow:**
```
(kernel captures uiautomator dump internally)
done    → { reason: "Screen shows: [App Name] with elements: title 'Inbox', 15 email items, first email from John — 'Meeting tomorrow at 3 PM'" }
```

### 13.2 Increase Text Size for Low Vision

**Goal:** "Make everything bigger on screen, I have trouble reading small text"

**Agent flow:**
```
shell   → { command: "settings put system font_scale 1.5" }
shell   → { command: "wm density 320" }
done
```

### 13.3 Enable TalkBack

**Goal:** "Turn on the screen reader for a visually impaired user"

**Agent flow:**
```
launch  → { action: "android.settings.ACCESSIBILITY_SETTINGS" }
tap     → TalkBack
tap     → toggle switch to enable
tap     → "Allow" / confirm
done
```

---

## 14. Testing & Development

### 14.1 UI Testing — Screenshot Every Screen

**Goal:** "Open the app com.myapp.debug, navigate through all main tabs, and take a screenshot of each"

**Agent flow:**
```
launch     → { package: "com.myapp.debug" }
screenshot → { filename: "tab1_home.png" }
tap        → second tab
screenshot → { filename: "tab2_search.png" }
tap        → third tab
screenshot → { filename: "tab3_profile.png" }
tap        → fourth tab
screenshot → { filename: "tab4_settings.png" }
done
```

### 14.2 Stress Test an App with Monkey

**Goal:** "Run a monkey test on com.myapp.debug with 1000 random events"

**Agent flow:**
```
shell   → { command: "monkey -p com.myapp.debug --throttle 100 -v 1000" }
done
```

### 14.3 Check App Permissions

**Goal:** "What permissions does WhatsApp have?"

**Agent flow:**
```
shell   → { command: "dumpsys package com.whatsapp" }
done    → { reason: "Granted permissions: CAMERA, CONTACTS, LOCATION, MICROPHONE, STORAGE, ..." }
```

### 14.4 Capture and Pull a Bug Report

**Goal:** "Generate a full bug report for debugging"

**Agent flow:**
```
shell   → { command: "bugreport /sdcard/bugreport.zip" }
(then via adb pull externally)
done
```

### 14.5 Clear App Data and Restart

**Goal:** "Reset com.myapp.debug to a clean state and relaunch it"

**Agent flow:**
```
shell   → { command: "pm clear com.myapp.debug" }
launch  → { package: "com.myapp.debug" }
done
```

---

## 15. Multi-Step Complex Workflows

### 15.1 Screenshot a Conversation and Share It

**Goal:** "Open WhatsApp, go to the chat with Alice, take a screenshot, then share it on Telegram to the 'Screenshots' group"

**Agent flow:**
```
launch     → { package: "com.whatsapp" }
tap        → search
type       → "Alice"
tap        → Alice's chat
screenshot → { filename: "alice_chat.png" }
home
launch     → { package: "org.telegram.messenger" }
tap        → search
type       → "Screenshots"
tap        → Screenshots group
tap        → attachment icon
tap        → gallery/file picker
tap        → alice_chat.png
tap        → send
done
```

### 15.2 Compare Prices Across Apps

**Goal:** "Search for 'Sony WH-1000XM5' on Amazon and Flipkart, take screenshots of both prices"

**Agent flow:**
```
launch     → { package: "com.amazon.mShop.android.shopping" }
tap        → search bar
type       → "Sony WH-1000XM5"
enter
screenshot → { filename: "amazon_price.png" }
home
launch     → { package: "com.flipkart.android" }
tap        → search bar
type       → "Sony WH-1000XM5"
enter
screenshot → { filename: "flipkart_price.png" }
done       → { reason: "Amazon: $XXX, Flipkart: ₹XXX" }
```

### 15.3 Check and Respond to All Notifications

**Goal:** "Pull down the notification shade, read all notifications, and dismiss the unimportant ones"

**Agent flow:**
```
shell      → { command: "cmd statusbar expand-notifications" }
wait       → shade opens
screenshot → capture notifications
tap        → swipe away promotional notifications
tap        → important notification to open it
(respond as needed)
done
```

### 15.4 Setup a New Phone — Basic Configuration

**Goal:** "Configure this device: enable WiFi, set brightness to 70%, set font size to large, disable auto-rotate, set screen timeout to 2 minutes"

**Agent flow:**
```
shell   → { command: "svc wifi enable" }
shell   → { command: "settings put system screen_brightness 179" }
shell   → { command: "settings put system font_scale 1.3" }
shell   → { command: "settings put system accelerometer_rotation 0" }
shell   → { command: "settings put system screen_off_timeout 120000" }
done
```

### 15.5 Debug Why an App is Slow

**Goal:** "Check why Chrome is running slow — look at memory usage, CPU, and recent crash logs"

**Agent flow:**
```
shell   → { command: "dumpsys meminfo com.android.chrome" }
shell   → { command: "dumpsys cpuinfo" }
shell   → { command: "dumpsys gfxinfo com.android.chrome" }
shell   → { command: "logcat -d -b crash -t 10" }
done    → { reason: "Chrome using 450MB RAM, 12% CPU, 3 dropped frames in last render, no recent crashes. High memory suggests too many tabs." }
```
