# ShiftGuard — Automated GPS Clock-In/Out Platform

## Overview

ShiftGuard is a multi-platform workforce management system built for care support companies. It solves the common problem of workers forgetting to clock in and out by using GPS geofencing to automatically log attendance. The system supports a full role hierarchy (HR, Manager, Team Leader, Worker) with web dashboards for managers/admins and native mobile apps for all staff.

---

## Tech Stack

### Backend
- **Runtime**: Node.js (Express) or Python (FastAPI) — choose one
- **Database**: PostgreSQL (primary data store)
- **Cache**: Redis (sessions, GPS state, rate limiting)
- **Auth**: JWT with role-based access control (RBAC)
- **Push Notifications**: Firebase Cloud Messaging (FCM) for Android, APNs for iOS
- **File Export**: PDF generation for timesheet downloads
- **GPS/Maps**: Google Maps API (geocoding + geofencing logic)

### Frontend — Web Dashboard
- **Framework**: Next.js 14 (App Router)
- **Styling**: Tailwind CSS
- **State**: React Query or Zustand

### Frontend — Mobile App
- **Framework**: React Native (Expo) — single codebase for iOS and Android
- **Background GPS**: Expo Location with background task support
- **Push**: Expo Notifications (wraps FCM/APNs)

### Infrastructure
- **Containerisation**: Docker + Docker Compose
- **Database migrations**: Prisma ORM
- **API docs**: Swagger/OpenAPI auto-generated

---

## Role Hierarchy & Permissions

```
HR / Super Admin
│   Full platform access
│   Assigns workers to managers
│   Sets global geofence radius (default 50m, adjustable per house)
│   Sees all houses, all workers, all timesheets
│
├── Manager (one per house group)
│   │   Assigned to specific houses only — cannot see other managers' houses
│   │   Creates and assigns shifts
│   │   Views workers currently on shift
│   │   Reviews and downloads confirmed timesheets
│   │   Sets timesheet confirmation to manual or auto per house
│   │
│   └── Team Leader (one per house)
│           Manages their single assigned house
│           Creates shifts for their house
│           Confirms worker timesheets (manual or auto)
│           Views who is on shift at their house
│
└── Worker
        Sees their own assigned shifts only
        GPS auto clock-in/out
        Manual clock-in/out override
        Views their own timesheet history
```

---

## Core Features

### 1. GPS Auto Clock-In/Out
- Worker app continuously monitors device location in the background
- When worker enters the geofence radius of their assigned house during a scheduled shift window → automatic clock-in
- Push notification sent: *"You've been clocked in at [House Name]"*
- When worker exits the geofence → prompt notification: *"Are you leaving? Clock out or stay clocked in?"*
- Worker can confirm clock-out or dismiss (remains clocked in)
- Manual clock-in/out always available as a fallback

### 2. Shift Management
- HR, Managers, and Team Leaders can all create shifts
- Shifts are tied to a specific house and assigned to specific workers
- Workers see only their own upcoming and past shifts
- Managers see all shifts for their houses
- HR sees all shifts platform-wide

### 3. Geofence Configuration
- Each house has a GPS coordinate (set from the house address on creation)
- Default geofence radius: 50 metres
- HR/Super Admin can adjust the default globally or override per house
- Radius stored in DB per house; mobile app fetches on shift start

### 4. Timesheets
- Every clock-in/out event is logged with timestamp, worker ID, house ID, method (auto/manual)
- Workers see their own timesheet log at any time
- Team Leader confirms entries for their house (manual confirmation or auto-confirm toggle)
- Once confirmed, Manager can view the confirmed timesheet and download it as PDF
- HR can see all timesheets across the platform

### 5. Notifications (push only)
- Clock-in confirmation
- Clock-out prompt when leaving geofence
- Missed clock-in alert (if shift start passes and no clock-in detected)
- Timesheet confirmed notification to worker
- All notifications are mobile push only (FCM / APNs)

---

## Data Models (simplified)

```sql
-- Users
users (id, name, email, password_hash, role, created_at)

-- Houses / locations
houses (id, name, address, latitude, longitude, geofence_radius_m, manager_id)

-- House assignments
house_workers (house_id, worker_id)
house_team_leaders (house_id, team_leader_id)

-- Shifts
shifts (id, house_id, worker_id, created_by, start_time, end_time, date)

-- Clock events
clock_events (id, worker_id, house_id, shift_id, type [in|out], method [auto|manual], timestamp)

-- Timesheets (aggregated view + confirmation state)
timesheets (id, worker_id, house_id, shift_id, clock_in_at, clock_out_at, total_hours, confirmed_by, confirmed_at, auto_confirmed)
```

---

## API Endpoints (key routes)

```
POST   /auth/login
POST   /auth/refresh

GET    /shifts                     — worker's own shifts
POST   /shifts                     — create shift (manager/TL/HR)
DELETE /shifts/:id

POST   /clock/in                   — manual clock in
POST   /clock/out                  — manual clock out
POST   /clock/auto-checkin         — called by mobile GPS trigger

GET    /timesheets/me              — worker's own timesheet
GET    /timesheets/house/:houseId  — TL/manager view
POST   /timesheets/:id/confirm     — TL confirms entry
GET    /timesheets/house/:houseId/export  — PDF download

GET    /houses                     — manager's assigned houses
POST   /houses                     — HR creates house
PATCH  /houses/:id/geofence        — HR sets radius

GET    /users                      — HR/manager view
POST   /users/assign               — HR assigns worker to manager
```

---

## Mobile App — GPS Background Logic

```
On shift start (computed from shift data fetched on app open):
  1. Register background location task
  2. Poll GPS every 30 seconds
  3. Compute distance from house coordinates
  4. If distance <= geofence_radius → trigger /clock/auto-checkin
  5. If clocked in and distance > geofence_radius → send clock-out prompt
  6. On shift end + still clocked in → auto clock-out + notify
```

Use `expo-location` with `startLocationUpdatesAsync` for background tracking.

---

## Project Structure

```
shiftguard/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── controllers/
│   │   ├── services/
│   │   │   ├── authService.js
│   │   │   ├── shiftService.js
│   │   │   ├── clockService.js
│   │   │   ├── geofenceService.js
│   │   │   ├── timesheetService.js
│   │   │   └── notificationService.js
│   │   ├── middleware/
│   │   │   ├── auth.js          (JWT verify + role check)
│   │   │   └── roleGuard.js
│   │   ├── models/              (Prisma schema)
│   │   └── utils/
│   ├── prisma/
│   │   └── schema.prisma
│   └── Dockerfile
│
├── web/                         (Next.js dashboard)
│   ├── app/
│   │   ├── (auth)/
│   │   ├── dashboard/
│   │   │   ├── shifts/
│   │   │   ├── timesheets/
│   │   │   ├── houses/
│   │   │   └── workers/
│   │   └── admin/
│   └── components/
│
├── mobile/                      (Expo React Native)
│   ├── app/
│   │   ├── (auth)/
│   │   ├── shifts/
│   │   ├── timesheets/
│   │   └── profile/
│   ├── tasks/
│   │   └── locationTask.ts      (background GPS)
│   └── services/
│       ├── clockService.ts
│       └── notificationService.ts
│
└── docker-compose.yml
```

---

## Environment Variables

```env
# Backend
DATABASE_URL=postgresql://user:pass@localhost:5432/shiftguard
REDIS_URL=redis://localhost:6379
JWT_SECRET=your_secret_here
GOOGLE_MAPS_API_KEY=your_key_here
FCM_SERVER_KEY=your_fcm_key_here

# Mobile
EXPO_PUBLIC_API_URL=https://your-api-url.com
EXPO_PUBLIC_GOOGLE_MAPS_KEY=your_key_here
```

---

## Build Order (recommended phases)

1. **Phase 1** — Auth system, user/role model, house/worker assignment
2. **Phase 2** — Shift creation and viewing (all roles)
3. **Phase 3** — GPS geofencing + auto clock-in/out (mobile)
4. **Phase 4** — Timesheet logging, TL confirmation, manager PDF export
5. **Phase 5** — Push notifications (FCM/APNs integration)
6. **Phase 6** — Web dashboard (manager/HR views, settings)
7. **Phase 7** — HR admin panel (global settings, geofence config, user management)

---

## Key Constraints & Business Rules

- A manager can only see houses assigned to them by HR
- A team leader can only manage the single house they are assigned to
- A worker's auto clock-in only fires if they have a shift scheduled at that house within the current time window
- Geofence radius is configurable per house by HR; falls back to global default (50m)
- Timesheet confirmation can be set to manual (TL must tap confirm) or auto (confirmed automatically after shift end)
- Only confirmed timesheets are visible to managers for download
- All clock-out prompts are non-blocking; worker can dismiss and remain clocked in
