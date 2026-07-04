using TaiwuRus.Shared;
using Xunit;

namespace TaiwuRus.Tests
{
    public class RuImageNameTests
    {
        [Theory]
        // plain trailing token
        [InlineData("ui9_btn_life_ru", true)]
        // token followed by a numeric state suffix (button states)
        [InlineData("ui9_btn_life_ru_2", true)]
        [InlineData("ui9_combat_roulette_btn_flaw_0_ru", true)]
        // "ru" inside a word is NOT a token
        [InlineData("ruin", false)]
        [InlineData("ui9_ruin_gate", false)]
        // token not at the end (non-numeric tail) is NOT a trailing token
        [InlineData("ui9_ru_button", false)]
        [InlineData("x_ru_extra", false)]
        // other languages
        [InlineData("ui9_btn_life_en", false)]
        [InlineData("ui9_btn_life_cn", false)]
        // degenerate inputs
        [InlineData("", false)]
        [InlineData(null, false)]
        public void HasRuToken_detects_only_trailing_language_tokens(string? name, bool expected)
        {
            Assert.Equal(expected, RuImageName.HasRuToken(name));
        }

        [Theory]
        [InlineData("ui9_btn_life_ru", "ui9_btn_life_en")]
        [InlineData("ui9_btn_life_ru_2", "ui9_btn_life_en_2")]
        [InlineData("Combat/ui9_combat_roulette_btn_flaw_0_ru", "Combat/ui9_combat_roulette_btn_flaw_0_en")]
        // no trailing token -> unchanged
        [InlineData("ruin", "ruin")]
        [InlineData("ui9_ru_button", "ui9_ru_button")]
        public void ToEn_rewrites_only_the_trailing_token(string ruName, string expected)
        {
            Assert.Equal(expected, RuImageName.ToEn(ruName));
        }

        [Theory]
        [InlineData("ui9_btn_life_ru", "ui9_btn_life_cn")]
        [InlineData("ui9_btn_life_ru_2", "ui9_btn_life_cn_2")]
        [InlineData("ruin", "ruin")]
        public void ToCn_rewrites_only_the_trailing_token(string ruName, string expected)
        {
            Assert.Equal(expected, RuImageName.ToCn(ruName));
        }
    }
}
