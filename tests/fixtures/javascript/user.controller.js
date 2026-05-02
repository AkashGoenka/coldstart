'use strict';

angular.module('app')
  .controller('UserController', ['$scope', 'UserService', function($scope, UserService) {
    $scope.users = [];
    $scope.selectedUser = null;

    $scope.loadUsers = function() {
      UserService.getUser(1).then(function(res) {
        $scope.users = res.data;
      });
    };

    $scope.selectUser = function(user) {
      $scope.selectedUser = user;
    };
  }]);
