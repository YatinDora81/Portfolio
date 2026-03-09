# Scaling WebSockets — What I Learned Building Real-Time Apps

WebSockets are easy to set up. Scaling them? That's a different story.

## The Challenge

When I built Drawsheet and Connect, single-server WebSocket worked fine in dev. But in production with multiple instances behind a load balancer, messages stopped reaching the right clients.

## The Fix: Pub/Sub Layer

I added Redis pub/sub between WebSocket servers. When a message comes in on Server A, it publishes to Redis. Server B subscribes and forwards to its connected clients.

## Key Takeaways

1. **Sticky sessions help** but aren't enough for true horizontal scaling
2. **Redis pub/sub** is lightweight and battle-tested for WS fan-out
3. **Heartbeat pings** are essential — don't trust TCP keepalive alone
4. **Reconnection logic** on the client side saves your UX

Real-time is addictive once you get it right.
