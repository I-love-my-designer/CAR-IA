# 🗺️ App Architecture Map

| Step | Page Title | Options / Buttons (Rows) | Thumbnail / Asset Description | Logic / Next Step |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Homepage** | START | App Logo / Splash | -> Shooting Conditions |
| 2 | **Your shooting conditions** | MOVING VEHICLE | Recommended (Dynamic tracking image) | -> Vehicle Category |
| | | MOVING CAMERA | Less Efficient (Static vehicle image) | -> Vehicle Category |
| 3 | **Vehicle Category** | CAR | Car side profile | -> Vehicle Type |
| | | UTILITY | Van/Utility side profile | -> Vehicle Type |
| | | BIKE | Motorcycle profile | -> Vehicle Type |
| 4 | **Vehicle Type** | SUV, Sport, Regular, City, Premium, Society | (Contextual images for Car) | -> Your Photo |
| | | Bus, Family, Society, Truck | (Contextual images for Utility) | -> Your Photo |
| | | City, Sport, Offroad, Collection | (Contextual images for Bike) | -> Your Photo |
| 5 | **Your Photo** | TAKE A PHOTO / CHANGE PHOTO | Camera Upload Component | Opens File Dialog |
| | | ISOLATE VEHICLE | Sparkles icon | -> Visual Style (once isolated) |
| 6 | **Visual Style** | DYNAMIC | Recommended for Bike | -> Environment |
| | | STRATEGIC | Recommended for Utility | -> Environment |
| | | ICONIC | Default Standard | -> Environment |
| 7 | **Environment** | Category Selection | Urban, Nature, Design (OUTSIDE/STUDIO), Minimal | Displays Variants |
| | | Variant Selection | Desert, Forest, Mountain, Seaside, etc. | -> The Base |
| 8 | **The Base** | MONOLITH, LIGHT RING, MIRROR, MINIMAL | 3D Stage Previews | -> Branding |
| 9 | **Branding** | LOGO | Upload Toggle (Checkbox logic) | -> Color & Light |
| | | TEXT | Text Input (Checkbox logic) | -> Color & Light |
| 10 | **Color & Light** | HUE PICKER | Color Gradient Strip | -> Masterpiece |
| | | INTENSITY | 0-100% Slider | -> Masterpiece |
| 11 | **Your Masterpiece** | KEEP SETTINGS / CHANGE PICTURE | Final Render | -> Back to "Your Photo" |
| | | DOWNLOAD | File Icon | Saves composition |
| | | EDIT / NEW | Refresh icons | -> Color & Light / Home |
