namespace ChatRoom.Models;

public class ChatMessage
{
    public string ConnectionId { get; set; } = "";
    public string Nickname { get; set; } = "";
    public string Color { get; set; } = "";
    public string Text { get; set; } = "";
    public string Timestamp { get; set; } = "";
}
