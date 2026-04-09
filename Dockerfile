# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

# Restore dependencies first (layer cache friendly)
COPY ChatRoom/ChatRoom.csproj ChatRoom/
RUN dotnet restore ChatRoom/ChatRoom.csproj

# Copy everything and publish
COPY ChatRoom/ ChatRoom/
WORKDIR /src/ChatRoom
RUN dotnet publish ChatRoom.csproj -c Release -o /app/publish --no-restore

# ── Stage 2: Runtime ───────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

# WebRTC getUserMedia requires HTTPS in production browsers.
# Run this app behind a reverse proxy (nginx/traefik) that terminates TLS,
# or access it via localhost for development.
EXPOSE 8080

ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production

ENTRYPOINT ["dotnet", "ChatRoom.dll"]
