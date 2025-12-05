# Carris Frontend

Frontend web application for the Carris Live bus tracking system. Provides an interactive map interface for real-time bus tracking in Lisbon.

## Features

- **Real-time Map**: Leaflet-based interactive map with live vehicle positions
- **Bus Tracking**: Click on buses to see detailed information and route
- **Stop Information**: View bus stop details and routes
- **Route Filtering**: Filter by specific routes
- **Multi-language**: Support for Portuguese and English
- **User Location**: Track your location on the map
- **WebSocket Updates**: Real-time position updates via Socket.IO

## Prerequisites

- Modern web browser with JavaScript enabled
- Backend API server running (see backend README)

## Installation

No installation required for basic usage. Simply serve the static files.

### For Development

You can use Python's built-in HTTP server:

```bash
python3 -m http.server 3000
```

Or any static file server of your choice.

## Configuration

### Backend API URL

The frontend automatically connects to the backend:
- **Local development**: `http://localhost:8000`
- **Production**: Uses the same hostname as frontend on port 8000

To customize, edit the `API_URL` constant in `script.js`:

```javascript
const API_URL = 'http://your-backend-url:8000';
```

## Running

### Development Server

```bash
npm run dev
```

Then open `http://localhost:3000` in your browser.

### Production with Nginx

Use the provided `Dockerfile` and `nginx.conf` for production deployment:

```bash
docker build -t carris-frontend .
docker run -p 80:80 carris-frontend
```

## Project Structure

```
frontend/
├── index.html          # Main HTML file
├── script.js           # Application logic and map functionality
├── lang/              # Language files
│   ├── en.json        # English translations
│   └── pt.json        # Portuguese translations
├── Dockerfile         # Docker configuration for nginx
├── nginx.conf         # Nginx configuration
└── package.json       # NPM configuration
```

## Features in Detail

### Map Controls
- **Zoom**: Use mouse wheel or zoom controls
- **Pan**: Click and drag to move around
- **Search**: Use the search box to find routes
- **Toggle Stops**: Show/hide bus stops on map

### Bus Selection
- Click any bus marker to see:
  - Route information
  - Current speed and bearing
  - License plate
  - Trip headsign
  - Route path (traveled in red, remaining in green)

### Route Filtering
- Enter route number in search box
- Press Enter or click Search
- Shows only buses and stops for that route

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## Technology Stack

- **Leaflet** - Interactive maps
- **Socket.IO** - Real-time communication
- **Vanilla JavaScript** - No framework dependencies
- **Nginx** - Production web server (Docker)
