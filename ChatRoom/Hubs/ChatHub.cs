using ChatRoom.Services;
using Microsoft.AspNetCore.SignalR;

namespace ChatRoom.Hubs;

public class ChatHub : Hub
{
    private readonly RoomService _roomService;

    public ChatHub(RoomService roomService) => _roomService = roomService;

    public override async Task OnConnectedAsync()
    {
        var http = Context.GetHttpContext();
        var nickname = http?.Request.Query["nickname"].ToString();
        var color = http?.Request.Query["color"].ToString();

        if (string.IsNullOrWhiteSpace(nickname)) nickname = "Anonim";
        if (string.IsNullOrWhiteSpace(color)) color = "#3b82f6";
        if (!color.StartsWith('#')) color = "#" + color;

        _roomService.AddUser(new Models.AppUser
        {
            ConnectionId = Context.ConnectionId,
            Nickname = nickname,
            Color = color
        });

        // Send current room counts immediately to the new connection
        await Clients.Caller.SendAsync("RoomCounts", _roomService.GetAllRoomCounts());

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var user = _roomService.GetUser(Context.ConnectionId);
        if (user?.RoomId != null)
        {
            var roomId = user.RoomId;
            _roomService.RemoveUser(Context.ConnectionId);
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
            await Clients.Group(roomId).SendAsync("UserLeft", Context.ConnectionId);
            await BroadcastRoomCounts();
        }
        else
        {
            _roomService.RemoveUser(Context.ConnectionId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(string roomId)
    {
        var user = _roomService.GetUser(Context.ConnectionId);
        if (user == null) return;

        // Leave current room if different
        if (user.RoomId != null && user.RoomId != roomId)
        {
            var oldRoom = user.RoomId;
            _roomService.LeaveRoom(Context.ConnectionId);
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, oldRoom);
            await Clients.Group(oldRoom).SendAsync("UserLeft", Context.ConnectionId);
        }

        _roomService.JoinRoom(Context.ConnectionId, roomId);
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);

        // Tell the new joiner who's already in the room (for WebRTC mesh)
        var existing = _roomService.GetUsersInRoom(roomId)
            .Where(u => u.ConnectionId != Context.ConnectionId)
            .Select(u => new { u.ConnectionId, u.Nickname, u.Color })
            .ToList();

        await Clients.Caller.SendAsync("RoomJoined", new { roomId, existingUsers = existing });

        // Tell existing users a new person arrived (they'll await offer from new user)
        await Clients.GroupExcept(roomId, Context.ConnectionId).SendAsync("UserJoined", new
        {
            connectionId = user.ConnectionId,
            nickname = user.Nickname,
            color = user.Color
        });

        await BroadcastRoomCounts();
    }

    public async Task LeaveRoom()
    {
        var user = _roomService.GetUser(Context.ConnectionId);
        if (user?.RoomId == null) return;

        var roomId = user.RoomId;
        _roomService.LeaveRoom(Context.ConnectionId);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        await Clients.Group(roomId).SendAsync("UserLeft", Context.ConnectionId);
        await BroadcastRoomCounts();
    }

    public async Task SendMessage(string text)
    {
        var user = _roomService.GetUser(Context.ConnectionId);
        if (user?.RoomId == null || string.IsNullOrWhiteSpace(text)) return;

        await Clients.Group(user.RoomId).SendAsync("ReceiveMessage", new
        {
            connectionId = Context.ConnectionId,
            nickname = user.Nickname,
            color = user.Color,
            text = text.Trim(),
            timestamp = DateTime.Now.ToString("HH:mm")
        });
    }

    // ── WebRTC Signaling ──────────────────────────────────────────────────────

    public async Task SendOffer(string targetConnectionId, string sdp)
        => await Clients.Client(targetConnectionId).SendAsync("ReceiveOffer", Context.ConnectionId, sdp);

    public async Task SendAnswer(string targetConnectionId, string sdp)
        => await Clients.Client(targetConnectionId).SendAsync("ReceiveAnswer", Context.ConnectionId, sdp);

    public async Task SendIceCandidate(string targetConnectionId, string candidate)
        => await Clients.Client(targetConnectionId).SendAsync("ReceiveIceCandidate", Context.ConnectionId, candidate);

    public async Task SetSpeaking(bool isSpeaking)
    {
        var user = _roomService.GetUser(Context.ConnectionId);
        if (user?.RoomId == null) return;
        await Clients.Group(user.RoomId).SendAsync("UserSpeaking", Context.ConnectionId, isSpeaking);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task BroadcastRoomCounts()
        => await Clients.All.SendAsync("RoomCounts", _roomService.GetAllRoomCounts());
}
