import type { UserThemeConfig } from 'valaxy-theme-yun'
import { defineValaxyConfig } from 'valaxy'

// add icons what you will need
const safelist = [
  'i-ri-home-line',
]

/**
 * User Config
 */
export default defineValaxyConfig<UserThemeConfig>({
  // site config see site.config.ts

  theme: 'yun',
  
  themeConfig: {
    banner: {
      enable: true,
      title: '月に吠えらんねぇ……',
      cloud: {
        enable: true,
      }
    },
    bg_image: {
      enable: true,
      url:"/wallpaper.jpg",
      dark: "/wallpaper.jpg",
      opacity: 0.2,
    },
    colors: {
      primary: '#2D4F82FF',
    },

    say : {
      enable: false,
      api: "string",
      hitokoto: {
          enable: false,
          api: "string",
        },
    }, 

    // pages: [
    //   // {
    //   //   name: '我的小伙伴们',
    //   //   url: '/links/',
    //   //   icon: 'i-ri-genderless-line',
    //   //   color: 'dodgerblue',
    //   // },
    //   // {
    //   //   name: '喜欢的女孩子',
    //   //   url: '/girls/',
    //   //   icon: 'i-ri-women-line',
    //   //   color: 'hotpink',
    //   // },
    // ],

    footer: {
      since: 2025,
      beian: {
        enable: true,
        icp: '还没备案呢',
      },
    },
  },

  unocss: { safelist },
  // addons: [
  //   addonWaline({
  //     serverURL: '后端链接',
  //     //以下功能未实现，但可以先写进配置里
  //     pageview: true,
  //     dark: 'auto',
  //     requiredMeta: ['nick','mail'],
  //     locale:{
  //       placeholder: '填写邮箱，可以收到回复通知~'
  //     }
        
  //   }),
  // ],
})

