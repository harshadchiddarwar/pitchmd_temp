# PitchMD™ - Snowflake Cortex

A modern web application that combines Vercel's hosting, Snowflake's data warehouse, and Snowflake Cortex AI to create an intelligent physician information assistant.

## Features

- **User Authentication**: Session-based authentication using Vercel KV with secure password hashing
- **Physician Management**: Dynamic dropdown listing physicians assigned to each user by sales geography
- **AI Conversations**: Real-time chat interface powered by Snowflake Cortex Agent
- **Audio Input**: Web Audio API for voice recording (ready for speech-to-text integration)
- **Minimal UI**: Clean, light-themed interface with rounded boxes and responsive design
- **Snowflake Integration**: Direct SQL API calls to Snowflake for data and AI queries

## Tech Stack

- **Frontend**: Next.js 16, React 19, TailwindCSS, Shadcn/UI
- **Backend**: Next.js API Routes, Serverless Functions
- **Database**: Snowflake (SQL API)
- **Authentication**: Vercel KV Redis sessions
- **AI**: Snowflake Cortex (mistral-large model)
- **Deployment**: Vercel

## Prerequisites

1. **Snowflake Account** with:
   - Active warehouse
   - API access enabled
   - User with SQL permissions
   - Cortex compute available

2. **Vercel Project** with:
   - KV Store integration enabled
   - Environment variables configured

3. **Node.js 18+** for local development

## Environment Setup

### 1. Create Snowflake Tables

Run the SQL script in your Snowflake warehouse:

```bash
# Option 1: Copy the SQL from scripts/setup-snowflake.sql and run in Snowflake UI
# Option 2: Use Snowflake CLI
snowsql -f scripts/setup-snowflake.sql
```

The script creates:
- `USERS` - User authentication and profile data
- `PHYSICIANS` - Physician information and specialties
- `USER_PHYSICIAN_ASSIGNMENT` - Assignments linking users to physicians by geography
- `CONVERSATION_HISTORY` - Message history for audit and analytics

### 2. Configure Environment Variables

In your Vercel project settings (Settings → Vars), add:

```
SNOWFLAKE_ACCOUNT=your_account_id
SNOWFLAKE_USER=your_username
SNOWFLAKE_PASSWORD=your_password
SNOWFLAKE_DATABASE=your_database_name
SNOWFLAKE_WAREHOUSE=your_warehouse_name
KV_REST_API_URL=https://your-kv.vercel.sh
KV_REST_API_TOKEN=your_kv_token
```

### 3. Install Dependencies

```bash
npm install
# or
pnpm install
```

### 4. Run Locally

```bash
npm run dev
```

Visit `http://localhost:3000`

### 5. Deploy to Vercel

```bash
git push origin main
```

Or use the Vercel CLI:

```bash
vercel
```

## API Routes

### Authentication

- `POST /api/auth/login` - Login with username/password
- `POST /api/auth/logout` - Destroy session

### Data Access

- `GET /api/physicians` - Fetch physicians assigned to current user
- `POST /api/cortex/query` - Send message and get AI response from Snowflake Cortex

## Project Structure

```
app/
├── page.tsx                 # Home redirect
├── login/
│   └── page.tsx            # Login page
├── dashboard/
│   └── page.tsx            # Main app interface
├── api/
│   ├── auth/
│   │   ├── login/route.ts
│   │   └── logout/route.ts
│   ├── physicians/route.ts
│   └── cortex/
│       └── query/route.ts
├── globals.css             # Tailwind + design tokens
└── layout.tsx              # Root layout

components/
├── physician-selector.tsx  # Dropdown for physicians
├── chat-interface.tsx      # Main chat area
└── audio-input.tsx         # Audio recording

lib/
├── snowflake.ts           # Snowflake SQL API client
├── auth.ts                # Session management
└── utils.ts               # Tailwind cn() utility

scripts/
└── setup-snowflake.sql    # Database initialization
```

## Key Features Explained

### 1. Physician Selector
- Displays all physicians assigned to the logged-in user
- Filters by sales geography from the assignment table
- Click to select a physician for conversation

### 2. Chat Interface
- Real-time message display with user/assistant differentiation
- Sends messages to Snowflake Cortex Agent
- Saves conversation history for audit

### 3. Audio Input
- Records audio via Web Audio API
- Currently captures raw audio (ready for transcription API integration)
- Stop button to end recording

### 4. Authentication
- Username/password login
- Auto-creates users on first login (demo mode)
- Session stored in Vercel KV with 24-hour expiration
- HTTP-only secure cookies

## Customization

### Add Speech-to-Text

Replace the audio placeholder in `components/audio-input.tsx`:

```typescript
// Example: Deepgram API integration
const transcription = await fetch('https://api.deepgram.com/v1/listen', {
  method: 'POST',
  body: audioBlob,
  headers: {
    'Authorization': `Token ${process.env.NEXT_PUBLIC_DEEPGRAM_KEY}`,
  },
});
```

### Customize Cortex Model

In `app/api/cortex/query/route.ts`, change:

```typescript
'mistral-large',  // Change to other available models
```

Available models: `mistral-7b`, `mistral-large`, `llama2-70b`, etc.

### Modify Color Scheme

Edit `app/globals.css` to change the design tokens:

```css
--primary: oklch(0.205 0 0);        /* Main color */
--accent: oklch(0.97 0 0);          /* Highlight color */
--background: oklch(1 0 0);         /* Light background */
```

## Demo Credentials

- Username: `john_rep`
- Password: `password`

These will auto-login to 2 assigned physicians in Northeast geography.

## Troubleshooting

### "Unauthorized" Error
- Check Snowflake credentials in environment variables
- Verify user has proper SQL permissions
- Check KV store connection

### "Failed to fetch physicians"
- Verify Snowflake account ID is correct (format: `xy12345`)
- Check warehouse is running
- Confirm USER_PHYSICIAN_ASSIGNMENT table has data

### Audio not recording
- Check browser permissions for microphone access
- Verify using HTTPS (required by Web Audio API in production)
- Check browser console for errors

### Cortex query timeout
- Verify Cortex compute is available
- Check warehouse has enough credits
- Review Snowflake query logs for failures

## Security Considerations

- **Passwords**: Hashed with bcrypt, never stored in plaintext
- **Sessions**: HTTP-only secure cookies, stored in KV with expiration
- **API**: All routes check session before executing
- **Data**: Snowflake connection uses parameterized queries (implement for production)
- **Frontend**: All sensitive operations happen server-side

## Next Steps

1. **Production Auth**: Replace demo auto-signup with proper user registration
2. **Speech-to-Text**: Integrate Deepgram or AssemblyAI for audio transcription
3. **Message Persistence**: Add database persistence for long-term conversation history
4. **Physician Context**: Enhance Cortex prompt with actual physician data from Snowflake
5. **Analytics**: Track usage patterns and AI response quality
6. **Role-Based Access**: Different UI/data access for different user roles

## Support

For issues with:
- **Snowflake**: Check Snowflake documentation and query logs
- **Vercel**: Visit vercel.com/help or check deployment logs
- **This app**: Review the code comments and component documentation

## License

MIT - Feel free to customize for your use case.
