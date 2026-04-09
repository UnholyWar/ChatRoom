using ChatRoom.Services;
using Microsoft.AspNetCore.Mvc;

namespace ChatRoom.Controllers;

public class LobbyController : Controller
{
    private readonly RoomService _roomService;

    public LobbyController(RoomService roomService) => _roomService = roomService;

    public IActionResult Index()
    {
        var nickname = HttpContext.Session.GetString("nickname");
        if (string.IsNullOrEmpty(nickname))
            return RedirectToAction("Index", "Home");

        ViewBag.Rooms = _roomService.GetRooms();
        ViewBag.Nickname = nickname;
        ViewBag.Color = HttpContext.Session.GetString("color") ?? "#3b82f6";
        return View();
    }
}
