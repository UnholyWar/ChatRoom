using Microsoft.AspNetCore.Mvc;

namespace ChatRoom.Controllers;

public class HomeController : Controller
{
    public IActionResult Index()
    {
        if (!string.IsNullOrEmpty(HttpContext.Session.GetString("nickname")))
            return RedirectToAction("Index", "Lobby");
        return View();
    }

    [HttpPost]
    public IActionResult Join(string nickname, string color)
    {
        if (string.IsNullOrWhiteSpace(nickname))
            return RedirectToAction("Index");

        if (string.IsNullOrWhiteSpace(color)) color = "#3b82f6";

        HttpContext.Session.SetString("nickname", ConvertTurkish(nickname.Trim()));
        HttpContext.Session.SetString("color", color);

        return RedirectToAction("Index", "Lobby");
    }

    public IActionResult Logout()
    {
        HttpContext.Session.Clear();
        return RedirectToAction("Index");
    }

    private static string ConvertTurkish(string input) =>
        input
            .Replace('ş', 's').Replace('Ş', 'S')
            .Replace('ğ', 'g').Replace('Ğ', 'G')
            .Replace('ü', 'u').Replace('Ü', 'U')
            .Replace('ö', 'o').Replace('Ö', 'O')
            .Replace('ı', 'i').Replace('İ', 'I')
            .Replace('ç', 'c').Replace('Ç', 'C');
}
