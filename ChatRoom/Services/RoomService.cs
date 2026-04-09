using ChatRoom.Models;
using System.Collections.Concurrent;

namespace ChatRoom.Services;

public class RoomService
{
    private readonly List<RoomDefinition> _rooms;
    private readonly ConcurrentDictionary<string, AppUser> _users = new();
    private readonly ConcurrentDictionary<string, HashSet<string>> _roomUsers = new();

    public RoomService(IConfiguration config)
    {
        _rooms = config.GetSection("Rooms").Get<List<RoomDefinition>>() ?? new();
        foreach (var room in _rooms)
            _roomUsers[room.Id] = new HashSet<string>();
    }

    public IReadOnlyList<RoomDefinition> GetRooms() => _rooms;

    public RoomDefinition? GetRoom(string roomId) =>
        _rooms.FirstOrDefault(r => r.Id.Equals(roomId, StringComparison.OrdinalIgnoreCase));

    public void AddUser(AppUser user) => _users[user.ConnectionId] = user;

    public AppUser? GetUser(string connectionId) => _users.GetValueOrDefault(connectionId);

    public void JoinRoom(string connectionId, string roomId)
    {
        if (!_users.TryGetValue(connectionId, out var user)) return;

        if (user.RoomId != null && _roomUsers.TryGetValue(user.RoomId, out var prev))
            lock (prev) prev.Remove(connectionId);

        user.RoomId = roomId;

        if (_roomUsers.TryGetValue(roomId, out var room))
            lock (room) room.Add(connectionId);
    }

    public void LeaveRoom(string connectionId)
    {
        if (!_users.TryGetValue(connectionId, out var user) || user.RoomId == null) return;

        if (_roomUsers.TryGetValue(user.RoomId, out var room))
            lock (room) room.Remove(connectionId);

        user.RoomId = null;
    }

    public void RemoveUser(string connectionId)
    {
        LeaveRoom(connectionId);
        _users.TryRemove(connectionId, out _);
    }

    public List<AppUser> GetUsersInRoom(string roomId)
    {
        if (!_roomUsers.TryGetValue(roomId, out var ids)) return new();
        lock (ids)
            return ids
                .Select(id => _users.GetValueOrDefault(id))
                .Where(u => u != null)
                .Select(u => u!)
                .ToList();
    }

    public int GetUserCountInRoom(string roomId)
    {
        if (!_roomUsers.TryGetValue(roomId, out var ids)) return 0;
        lock (ids) return ids.Count;
    }

    public Dictionary<string, int> GetAllRoomCounts() =>
        _rooms.ToDictionary(r => r.Id, r => GetUserCountInRoom(r.Id));
}
