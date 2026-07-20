# Watergun Assassin - Mobile App Design

## Color Palette

- **Primary**: #FF1493 (Hot Pink - matches the neon pink branding)
- **Secondary**: #00D4FF (Cyan/Electric Blue - water theme)
- **Accent**: #7B2FFF (Purple - for power-ups and special effects)
- **Background Dark**: #0A0A0F (Near black with slight blue tint)
- **Surface Dark**: #1A1A2E (Dark card surfaces)
- **Success**: #00FF88 (Neon green - eliminations confirmed)
- **Warning**: #FFB800 (Amber - purge mode, timers)
- **Error/Danger**: #FF3333 (Red - eliminations, deaths)
- **Foreground**: #FFFFFF (White text on dark)
- **Muted**: #8B8B9E (Gray text)

## Screen List

### Authentication
1. **Login Screen** - OAuth login with Watergun Assassin branding

### Main Tabs (Player View)
2. **Home Screen** - Game status dashboard, safe object display, round timer, purge timer
3. **Map Screen** - Target location, power-up pickups, player locations during purge
4. **Shop Screen** - Power-up store with categories and pricing
5. **Chat Screen** - Game chat with all players
6. **Profile Screen** - Player stats, achievements, settings

### Game Screens
7. **Kill Feed** - Live elimination approvals/denials, revivals
8. **Target Detail** - Target info, map to target
9. **Elimination Upload** - Video upload for kill verification
10. **Achievements** - Badge collection and progress

### Admin Screens
11. **Admin Dashboard** - Game overview, player management
12. **Game Setup** - Create/configure new game
13. **Rules Manager** - Toggle standard rules, add custom rules
14. **Player Management** - Mark paid, safe, revive, eliminate
15. **Power-Up Setup** - Configure shop items, pricing, time limits
16. **Elimination Review** - Approve/deny video evidence
17. **Round Control** - Start/end rounds, purge, assign targets
18. **Achievement Setup** - Create badges and point values

## Primary Content and Functionality

### Home Screen
- Large countdown timer (round time remaining)
- Purge timer (if active, pulsing red/amber)
- Current safe object display (prominent, always visible)
- Target name and photo
- Partner name (if teams mode)
- Quick action buttons: Upload Kill, View Map, Shop
- Game type badge (LMS, Points, Eliminations, Teams)
- Player status (Alive/Eliminated/Safe)

### Map Screen
- Full-screen map with player markers
- Target's last known location (with timestamp)
- Hidden power-up markers (visible or clue-based per admin config)
- During purge: all player locations (toggle by admin)
- Color-coded markers: Target (red), Self (blue), Power-ups (purple), Players (white during purge)

### Shop Screen
- Grid of power-up cards with emoji, name, cost, duration
- Player's current point balance
- Purchase confirmation with timer info
- Categories: Offensive, Defensive, Utility, Special
- Discounts shown with strikethrough pricing
- Disabled items shown grayed out (admin toggled off)

### Chat Screen
- Real-time group chat
- Message bubbles with player names
- System messages for game events
- Ability to send text messages

### Profile Screen
- Avatar/username
- Current game stats: Kills, Deaths, Points, Rank
- Lifetime stats: Games played, Win rate, Total kills
- Active power-ups with time remaining
- Purchased power-ups inventory
- Achievement badges earned
- Points balance

### Kill Feed
- Chronological list of game events
- Elimination approved: "[Player A] eliminated [Player B]" with green checkmark
- Elimination denied: "[Player A]'s claim on [Player B] denied" with red X
- Revival: "[Player C] has been revived!" with heart icon
- Purge start/end announcements
- Round transitions

### Admin Dashboard
- Game status overview (active players, eliminated, round #)
- Quick actions: Start Purge, End Round, Assign Targets
- Pending elimination reviews count
- Revenue tracker (entry fees collected)

### Game Setup (Admin)
- Game type selector (Last Man Standing, Highest Points, Most Eliminations, Teams)
- Entry fee input
- Round length configuration
- Safe object definition
- Target assignment mode (Auto/Manual)
- Power-up shop configuration
- Achievement badge setup
- Rule toggles and custom rules

## Key User Flows

### Player Elimination Flow
1. Player spots target → Opens camera/video
2. Records elimination video → Uploads via app
3. Admin receives notification → Reviews video
4. Admin approves/denies → Kill feed updates
5. If approved: Target eliminated, player gets new target
6. Points awarded, achievements checked

### Purge Flow
1. Admin activates purge → All players notified
2. Map shows all player locations
3. Safe objects disabled
4. Any player can eliminate any player
5. Timer counts down
6. Admin ends purge → Normal play resumes

### Power-Up Purchase Flow
1. Player opens shop → Browses power-ups
2. Selects power-up → Sees cost, duration, effect
3. Confirms purchase → Points deducted
4. Power-up activates → Timer starts
5. Effect applies (e.g., GPS hidden, shield active)

### Admin Game Management Flow
1. Create game → Set type, rules, entry fee
2. Players join → Admin marks paid
3. Admin assigns targets (auto or manual)
4. Game starts → Round timer begins
5. Monitor eliminations → Approve/deny
6. End round → Reassign targets
7. Repeat until winner determined

## Navigation Structure

- **Tab Bar** (5 tabs): Home, Map, Shop, Chat, Profile
- **Stack Navigation** within each tab for detail screens
- **Admin Panel** accessible from Profile tab (admin role only)
- **Modal** for elimination upload, power-up purchase confirmation
