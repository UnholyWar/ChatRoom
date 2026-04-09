namespace ChatRoom.Models;

public class AppUser
{
    public string ConnectionId { get; set; } = "";
    public string Nickname { get; set; } = "";
    public string Color { get; set; } = "#3b82f6";
    public string? RoomId { get; set; }
}
