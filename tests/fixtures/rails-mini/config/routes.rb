Rails.application.routes.draw do
  resources :posts
  get '/admin', to: 'admin#index'
end
