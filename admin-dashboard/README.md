# Order Tracking Admin Dashboard

A separate admin dashboard for viewing comprehensive analytics and reports for the order tracking system. This dashboard is designed to be deployed on Netlify with username/password protection.

## Features

- **Secure Authentication**: Username/password protection
- **Dashboard Overview**: Key metrics and statistics
- **Shop Management**: View and manage all connected shops
- **Billing Analytics**: Revenue tracking and subscription management
- **Tracking Analytics**: Detailed tracking request analytics
- **Comprehensive Reports**: Exportable reports in CSV and JSON formats
- **Responsive Design**: Works on desktop and mobile devices

## Tech Stack

- **Frontend**: Next.js, React, Tailwind CSS
- **Charts**: Recharts
- **HTTP Client**: Axios
- **Date Handling**: date-fns
- **Deployment**: Netlify

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Variables

Create a `.env.local` file in the root directory:

```env
BACKEND_URL=https://your-backend-api.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_secure_password
```

### 3. Development

```bash
npm run dev
```

The application will be available at `http://localhost:3000`

### 4. Build for Production

```bash
npm run build
```

## Netlify Deployment

### Option 1: Netlify CLI

1. Install Netlify CLI:
```bash
npm install -g netlify-cli
```

2. Login to Netlify:
```bash
netlify login
```

3. Deploy:
```bash
netlify deploy --prod
```

### Option 2: Git Integration

1. Push your code to a Git repository (GitHub, GitLab, etc.)
2. Connect your repository to Netlify
3. Set build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `out`
4. Add environment variables in Netlify dashboard:
   - `BACKEND_URL`: Your backend API URL
   - `ADMIN_USERNAME`: Admin username
   - `ADMIN_PASSWORD`: Admin password

### Option 3: Manual Deploy

1. Build the project:
```bash
npm run build
```

2. Drag and drop the `out` folder to Netlify's deploy interface

## Environment Variables

| Variable | Description | Example |
|----------|-------------|----------|
| `BACKEND_URL` | Backend API base URL | `https://api.example.com` |
| `ADMIN_USERNAME` | Admin login username | `admin` |
| `ADMIN_PASSWORD` | Admin login password | `secure_password_123` |

## Security Features

- **Authentication Required**: All pages require login
- **Secure Headers**: CSP, XSS protection, etc.
- **Environment-based Credentials**: Passwords stored in environment variables
- **Session Management**: Cookie-based authentication
- **Auto Logout**: Automatic logout on token expiration

## API Integration

The dashboard connects to your existing backend APIs:

- `GET /api/admin/dashboard` - Dashboard overview data
- `GET /api/admin/shops` - Shop management data
- `GET /api/admin/billing` - Billing and subscription data
- `GET /api/admin/tracking` - Tracking analytics data
- `GET /api/admin/reports` - Comprehensive reports data

## Pages

### Dashboard (`/`)
- Overview statistics
- Revenue trends
- Recent activity
- Quick metrics

### Shops (`/shops`)
- All connected shops
- Shop status and plans
- Search and filtering
- Shop performance metrics

### Billing (`/billing`)
- Revenue analytics
- Subscription management
- Payment history
- Revenue trends

### Tracking Analytics (`/tracking`)
- Tracking request analytics
- Carrier performance
- Request trends
- Popular tracking patterns

### Reports (`/reports`)
- Comprehensive analytics
- Exportable reports (CSV, JSON)
- Custom date ranges
- Performance insights

## Customization

### Styling
- Modify `styles/globals.css` for global styles
- Update `tailwind.config.js` for theme customization
- Colors and branding can be adjusted in the config

### Authentication
- Update credentials in environment variables
- Modify `pages/_app.js` for different auth logic
- Add additional security measures as needed

### API Endpoints
- Update API calls in individual page components
- Modify `next.config.js` for different backend URLs
- Add new endpoints as your backend expands

## Troubleshooting

### Build Issues
- Ensure all dependencies are installed: `npm install`
- Check Node.js version (requires Node 16+)
- Verify environment variables are set

### Deployment Issues
- Check Netlify build logs
- Verify environment variables in Netlify dashboard
- Ensure `netlify.toml` configuration is correct

### Authentication Issues
- Verify environment variables are set correctly
- Check browser cookies and local storage
- Ensure backend API is accessible

## Support

This admin dashboard is designed to work independently of your main application. It connects to your existing backend APIs to display analytics and management data without modifying any existing code.

For issues or customizations, refer to the individual component files and API integration points.