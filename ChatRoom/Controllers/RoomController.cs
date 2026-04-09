using ChatRoom.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChatRoom.Controllers;

public class RoomController : Controller
{
    private readonly RoomService _roomService;

    public RoomController(RoomService roomService) => _roomService = roomService;

    public IActionResult Index(string id)
    {
        var nickname = HttpContext.Session.GetString("nickname");
        if (string.IsNullOrEmpty(nickname))
            return RedirectToAction("Index", "Home");

        var room = _roomService.GetRoom(id);
        if (room == null)
            return RedirectToAction("Index", "Lobby");

        ViewBag.RoomId = room.Id;
        ViewBag.RoomName = room.Name;
        ViewBag.Nickname = nickname;
        ViewBag.Color = HttpContext.Session.GetString("color") ?? "#3b82f6";
        return View();
    }
}
